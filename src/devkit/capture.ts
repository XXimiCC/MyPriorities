/**
 * Съёмка кадра, вырез и кодирование.
 *
 * Порядок обратный привычному: сначала снимаем весь экран, и только потом
 * человек выделяет область на застывшем кадре. Наивный порядок (затемнить →
 * потянуть рамку → снять) в живом приложении ломается тремя способами: тост
 * успевает исчезнуть посреди перетаскивания, затемнение и резиновая рамка
 * рискуют попасть в растр, а координаты выреза относятся к странице, которая за
 * это время изменилась. Цена — полсекунды со спиннером.
 *
 * Отказ на любом шаге не блокирует тикет: причина уезжает полем shotError, и
 * отчёт уходит текстом. Инструмент отладки, который молчит, когда сломалось
 * всё, — это обуза, а не инструмент.
 */

import { clampRect, fitWithin, scaleRect, shrinkStep } from './geometry';
import { drawStrokes } from './strokes';
import type { Rect, ShotError, ShotInfo, Size, Stroke } from './types';

/**
 * Потолок плотности. iPhone рапортует 3, и колонка шириной 460 CSS-пикселей
 * превратилась бы в кадр 1380 пикселей — отчёт о баге в разрешении обоев.
 * Настоящая плотность уезжает в тикет отдельным полем, аналитически ничего
 * не теряется.
 */
const MAX_DPR = 2;

/** Длинная сторона готового кадра. */
const MAX_SIDE = 1280;

/** Потолок веса. С запасом под серверный предел в мегабайт. */
const MAX_BYTES = 400_000;

/**
 * Два разных срока, и путать их нельзя — это стоило лендингу всей съёмки.
 *
 * ASSET_WAIT — сколько библиотека ждёт, пока догрузятся картинки и шрифты. На
 * странице с ленивыми картинками ниже сгиба ждать их бессмысленно: браузер не
 * начнёт грузить то, до чего не долистали, и ожидание упирается в срок целиком.
 * Полторы секунды — это «дай доехать тому, что уже в пути»; всё остальное в
 * кадр и не попало бы, оно за пределами окна.
 *
 * RASTER_TIMEOUT — сколько ждём кадр целиком, вместе с отрисовкой.
 *
 * Пока оба были равны шести секундам, библиотека переставала ждать ресурсы
 * ровно в тот момент, когда наш собственный срок уже истекал, и до отрисовки
 * дело не доходило никогда: тикет уходил без кадра. С разведёнными сроками
 * тяжёлая страница снимается за две с половиной секунды вместо двадцати шести.
 */
export const ASSET_WAIT = 1500;
export const RASTER_TIMEOUT = 8000;

/** Метка закреплённых элементов на время съёмки. Живёт миллисекунды, см. ниже. */
const PINNED = 'data-devkit-pinned';

/** Что в кадр не попадает никогда: чужое содержимое, которое браузер не отдаёт. */
const SKIPPED = new Set(['IFRAME', 'OBJECT', 'EMBED']);

export class CaptureFailed extends Error {
  /* Причина держится полем, а не через `cause`: сборка целится в ES2020, где
     второго аргумента у Error ещё нет. */
  constructor(
    readonly reason: ShotError,
    readonly because?: unknown,
  ) {
    super(reason);
    this.name = 'CaptureFailed';
  }
}

export interface Still {
  canvas: HTMLCanvasElement;
  /** Во сколько раз пиксели кадра крупнее CSS-пикселей страницы. */
  scale: number;
  /** Размер снятого в CSS-пикселях — в этих координатах живут вырез и штрихи. */
  css: Size;
}

/** Копия wallpaper/save.ts: панель переносится отдельно и на приложение не ссылается. */
async function waitForFonts(): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    /* в старых движках document.fonts может отсутствовать — не повод падать */
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      window.setTimeout(() => reject(new CaptureFailed('timeout')), ms);
    }),
  ]);
}

export async function captureStill(root: HTMLElement): Promise<Still> {
  // Шрифт должен быть готов до растеризации, иначе каждая подпись уедет по
  // собственным метрикам и кадр перестанет совпадать с экраном.
  await waitForFonts();

  let domToCanvas: typeof import('modern-screenshot').domToCanvas;
  try {
    ({ domToCanvas } = await import('modern-screenshot'));
  } catch (error) {
    // Ленивый кусок не догрузился — обычно это офлайн. Ровно тот случай, ради
    // которого тикет обязан уходить и без кадра.
    throw new CaptureFailed('import-failed', error);
  }

  const scale = Math.min(window.devicePixelRatio || 1, MAX_DPR);

  /*
   * Кадр — это то, что видно, а не весь документ.
   *
   * У приложения разницы нет: его корень ровно с окно и никогда не
   * прокручивается. А обычная страница — документация, лендинг — высотой в
   * несколько тысяч пикселей, и без этого ограничения получалась бы длинная
   * узкая полоска, на которой не разобрать ни строчки. Прокрутка при этом не
   * теряется: её восстанавливает сама библиотека, см. features ниже.
   */
  const box = root.getBoundingClientRect();
  const width = Math.min(root.clientWidth || box.width, window.innerWidth);
  const height = Math.min(root.clientHeight || box.height, window.innerHeight);

  /*
   * Закреплённые элементы и прокрутка.
   *
   * Восстанавливая прокрутку, библиотека сдвигает содержимое вверх — вместе с
   * ним уезжает и то, что на живой странице никуда не уезжает: шапка, боковое
   * меню. Внутри foreignObject окна нет, и `position: fixed` теряет смысл.
   *
   * Поэтому такие элементы помечаются ДО клонирования (по атрибуту их потом
   * можно найти в копии — стили там переписаны, а атрибуты нет) и сдвигаются
   * обратно ровно на прокрутку. У приложения таких элементов нет вовсе:
   * страница не прокручивается, и весь этот код молча ничего не делает.
   */
  const scrolled = root.scrollTop || window.scrollY || 0;
  const pinned = scrolled
    ? Array.from(root.querySelectorAll<HTMLElement>('*')).filter(
        (node) => getComputedStyle(node).position === 'fixed',
      )
    : [];
  for (const node of pinned) node.setAttribute(PINNED, '');

  let canvas: HTMLCanvasElement;
  try {
    canvas = await withTimeout(
      domToCanvas(root, {
        width,
        height,
        scale,
        // Приложение только тёмное: прозрачные места в просмотрщике Telegram
        // показались бы белыми.
        backgroundColor: '#000000',
        filter: (node) => {
          if (!(node instanceof Element)) return true;
          // Интерфейс самой панели в собственный кадр не попадает.
          if (node.hasAttribute('data-devkit')) return false;
          /*
           * Встроенные фреймы пропускаются, и это не упрощение.
           *
           * Содержимое чужого домена прочитать нельзя ни при каких условиях —
           * браузер не отдаст его ни нам, ни библиотеке. Попытка обойтись без
           * этого правила стоила лендингу всей съёмки: страница с фреймом
           * приложения не укладывалась в отведённое время и тикет уходил без
           * кадра. Дырка на месте фрейма честнее, чем отсутствие кадра.
           */
          return !SKIPPED.has(node.tagName);
        },
        /*
         * Прокрутка клона по умолчанию выключена, и это здесь ловушка: у
         * приложения html и body с overflow: hidden, а прокручивается ровно
         * один .app__body. Без этого флага наполовину пролистанный экран
         * снимался бы сверху — то есть кадр показывал бы то, чего человек не
         * видел, и тикет получался бы про несуществующий баг.
         */
        features: { restoreScrollPosition: true },
        onCloneNode: (clone) => {
          if (!(clone instanceof Element)) return;
          for (const node of clone.querySelectorAll<HTMLElement>(`[${PINNED}]`)) {
            node.style.setProperty('translate', `0 ${scrolled}px`, 'important');
          }
        },
        timeout: ASSET_WAIT,
      }),
      RASTER_TIMEOUT,
    );
  } catch (error) {
    if (error instanceof CaptureFailed) throw error;
    throw new CaptureFailed('raster-failed', error);
  } finally {
    // Отметки не должны пережить съёмку: они на живой странице, а не в копии.
    for (const node of pinned) node.removeAttribute(PINNED);
  }

  /* Библиотека проставляет холсту инлайновый размер в CSS-пикселях. Инлайн
     сильнее любого класса, и кадр вылезал бы из отведённой ему рамки, показывая
     себя в масштабе 1:1 с обрезанными краями. */
  canvas.removeAttribute('style');

  return { canvas, scale, css: { w: canvas.width / scale, h: canvas.height / scale } };
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  /*
   * WebP, откат на JPEG, и никогда PNG: интерфейс тёмный и градиентный, PNG на
   * нём даёт 300–900 КБ там, где WebP укладывается в 60–150. Если движок формат
   * не знает, toBlob молча отдаёт PNG — поэтому проверяется тип ответа, а не
   * наличие ответа.
   */
  const attempt = (mime: string): Promise<Blob | null> =>
    new Promise((resolve) => {
      canvas.toBlob(resolve, mime, quality);
    });

  return attempt('image/webp').then(async (webp) => {
    if (webp && webp.type === 'image/webp') return webp;
    const jpeg = await attempt('image/jpeg');
    if (jpeg) return jpeg;
    throw new CaptureFailed('encode-failed');
  });
}

/**
 * Вырезать, наложить штрихи, ужать до предела.
 *
 * `crop` и `strokes` — в CSS-координатах стоп-кадра: в них же их и рисовали.
 */
export async function exportShot(
  still: Still,
  crop: Rect,
  strokes: readonly Stroke[],
): Promise<{ blob: Blob; info: ShotInfo }> {
  const source = clampRect(scaleRect(crop, still.scale), {
    w: still.canvas.width,
    h: still.canvas.height,
  });
  if (source.w < 1 || source.h < 1) throw new CaptureFailed('encode-failed');

  const fit = fitWithin({ w: source.w, h: source.h }, { w: MAX_SIDE, h: MAX_SIDE });

  for (let step = 0; ; step += 1) {
    const rung = shrinkStep(step);
    // Лестница конечна намеренно: «а вдруг ещё разок» на слабом телефоне
    // превращается в зависшее приложение.
    if (!rung) throw new CaptureFailed('too-large');

    const k = fit * rung.scale;
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(source.w * k));
    out.height = Math.max(1, Math.round(source.h * k));

    const ctx = out.getContext('2d');
    if (!ctx) throw new CaptureFailed('encode-failed');

    ctx.drawImage(still.canvas, source.x, source.y, source.w, source.h, 0, 0, out.width, out.height);

    /* Штрихи живут в CSS-координатах всего кадра, а рисовать их надо в
       координатах выреза. Перенос и масштаб задаются матрицей один раз — так
       толщина линии тоже масштабируется сама и не превращается в волосок. */
    const unit = still.scale * k;
    ctx.setTransform(unit, 0, 0, unit, -crop.x * unit, -crop.y * unit);
    drawStrokes(ctx, strokes, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    const blob = await encode(out, rung.quality);
    if (blob.size <= MAX_BYTES) {
      return {
        blob,
        info: {
          mime: blob.type,
          w: out.width,
          h: out.height,
          bytes: blob.size,
          crop: {
            x: Math.round(crop.x),
            y: Math.round(crop.y),
            w: Math.round(crop.w),
            h: Math.round(crop.h),
          },
          strokes: strokes.length,
        },
      };
    }
  }
}
