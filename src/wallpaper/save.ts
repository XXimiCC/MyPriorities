/**
 * Сохранение готовых обоев.
 *
 * Три пути, по убыванию удобства:
 *   1. Web Share — единственный надёжный способ положить картинку в «Фото» на iOS;
 *   2. <a download> — Android и десктоп;
 *   3. показ картинки во весь экран с подсказкой сохранить долгим нажатием.
 *
 * Telegram.WebApp.downloadFile сюда не подходит: он принимает только публичный
 * HTTPS-адрес, а у нас картинка существует лишь как blob в памяти.
 */

import { t } from '../i18n';

export type SaveOutcome = 'shared' | 'downloaded' | 'manual';

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob вернул пусто'));
    }, 'image/png');
  });
}

/** Шрифт должен быть готов до отрисовки текста, иначе подпись уедет по метрикам. */
export async function waitForFonts(): Promise<void> {
  try {
    await document.fonts?.ready;
  } catch {
    /* в старых движках document.fonts может отсутствовать — не повод падать */
  }
}

/**
 * Отдаёт готовый blob пользователю. Используется и для обоев, и для выгрузки
 * данных в JSON — способы сохранения на мобильных одни и те же.
 *
 * Вызывать строго синхронно из обработчика нажатия и с уже готовым blob:
 * после await Safari считает жест потраченным и отклоняет navigator.share.
 */
export async function saveFile(
  blob: Blob,
  fileName: string,
  mimeType = 'image/png',
): Promise<SaveOutcome> {
  const file = new File([blob], fileName, { type: mimeType });

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      // AbortError — пользователь закрыл шторку сам, дальше предлагать нечего.
      if (error instanceof DOMException && error.name === 'AbortError') return 'shared';
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  if ('download' in anchor) {
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 20_000);
    return 'downloaded';
  }

  URL.revokeObjectURL(url);
  return 'manual';
}

export interface ScreenSize {
  id: string;
  label: string;
  width: number;
  height: number;
}

/** Реальное разрешение экрана в пикселях — под него и рендерим по умолчанию. */
export function deviceSize(): ScreenSize {
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(Math.min(window.screen.width, window.screen.height) * ratio);
  const height = Math.round(Math.max(window.screen.width, window.screen.height) * ratio);
  return { id: 'device', label: t('wallpaper.myScreen'), width, height };
}

/** Названия устройств — имена собственные и не переводятся. */
export function sizePresets(): ScreenSize[] {
  return [
    { id: 'iphone-pro', label: 'iPhone Pro', width: 1179, height: 2556 },
    { id: 'iphone-max', label: 'iPhone Max', width: 1290, height: 2796 },
    { id: 'android', label: 'Android', width: 1440, height: 3120 },
    { id: 'ipad', label: 'iPad', width: 2048, height: 2732 },
    { id: 'desktop', label: t('wallpaper.desktop'), width: 2560, height: 1440 },
  ];
}
