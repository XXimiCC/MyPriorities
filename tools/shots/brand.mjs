/*
 * Фирменные картинки: иконки приложения, фавиконы и превью ссылки.
 *
 *   npm run brand
 *
 * Логотипа у приложения нет и не было — его роль играет сама батарея из
 * references/high.jpg. Поэтому иконки не рисуются в редакторе, а собираются из
 * той же геометрии, что и иконка в шапке: разъехаться им тогда физически негде.
 *
 * Живёт скрипт в tools/shots/, а не в собственном каталоге, ровно по одной
 * причине: Playwright установлен здесь, а node ищет node_modules вверх по
 * дереву. Из соседнего каталога он бы не разрешился, а второй package.json
 * означал бы вторую установку Chromium на полтораста мегабайт.
 *
 * Chromium вместо канваса или готовой библиотеки — потому что он уже стоит
 * ради docs:shots, а нужен нам ровно его рендер SVG со свечением: тот же
 * движок, что показывает приложение живым людям.
 *
 * Оговорка про надписи: текст на og.png рисуется системным шрифтом машины,
 * которая запустила скрипт. Файл коммитится, так что на практике это шрифт
 * того, кто пересобирал последним. Специально не чиним — приложение и само
 * рендерится системным шрифтом (см. --font в src/styles/tokens.css).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

/*
 * Копия src/components/batteryGeometry.ts. Копия, а не импорт: .tsx и .ts
 * с типами node без сборки не подгрузит, а тянуть сюда tsx-загрузчик ради
 * двадцати чисел незачем. Что копия не разъехалась с оригиналом, сторожит
 * tools/brand.test.ts при обычном npm test — тем же приёмом, которым
 * tools/docs.test.ts сторожит связность документации.
 */
export const GEOMETRY = {
  viewWidth: 112,
  viewHeight: 53,
  body: { x: 1.4, y: 1.4, w: 100, h: 50, rx: 8.5 },
  stroke: 2.4,
  nub: { w: 8.5, h: 22, rx: 3 },
  cell: { insetX: 7.5, insetY: 6.4, w: 24.8, gap: 5.3, rx: 4 },
};

export const BOLT_PATH = 'M56 9 L38.5 30.5 H49 L46 45 L63.5 23.5 H53 Z';

/** BATTERY_THEMES[3] из src/domain/palette.ts: полный заряд, три ячейки. */
const HIGH = { hex: '#22e356', soft: '#6bf58f' };

/** Токены из src/styles/tokens.css, нужные надписям на og.png. */
const BG = '#000000';
const TEXT = '#f4f4f5';
const TEXT_DIM = 'rgba(244, 244, 245, 0.62)';
const TEXT_FAINT = 'rgba(244, 244, 245, 0.34)';
const HAIRLINE = 'rgba(255, 255, 255, 0.09)';
const FONT = `'Inter Tight', Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

/*
 * Иконки. inset — поле с каждой стороны в долях стороны иконки.
 *
 * У maskable поле больше не «на всякий случай», а по расчёту: система вправе
 * срезать всё вне круга диаметром в две трети стороны. Батарея широкая
 * (112:53), и в круг её вписывает не ширина, а диагональ: при ширине w высота
 * равна 0.473w, диагональ — 1.106w. При inset 0.22 ширина выходит 0.56 стороны,
 * диагональ 0.62 — с запасом внутри 0.667. При inset 0.14, как у обычных
 * иконок, диагональ была бы 0.796 и носик батареи срезало бы.
 *
 * glow: false у 32 пикселей — три слоя свечения на такой стороне сливаются
 * в зелёное пятно, и батарея перестаёт читаться. Ровно та же оговорка уже
 * сделана в src/App.tsx про молнию на двадцати пикселях.
 */
const ICONS = [
  { out: ['public/icons/icon-192.png'], size: 192, inset: 0.14, glow: true },
  { out: ['public/icons/icon-512.png'], size: 512, inset: 0.14, glow: true },
  { out: ['public/icons/icon-maskable-512.png'], size: 512, inset: 0.22, glow: true },
  { out: ['public/apple-touch-icon.png', 'landing/public/apple-touch-icon.png'], size: 180, inset: 0.16, glow: true },
  { out: ['public/favicon-32.png', 'landing/public/favicon-32.png'], size: 32, inset: 0.08, glow: false },
];

const SVG_ICONS = ['public/favicon.svg', 'landing/public/favicon.svg'];

const OG = { out: ['landing/public/og.png'], width: 1200, height: 630 };

function log(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * Та же батарея, что рисует BatteryIcon.tsx, и в том же порядке элементов:
 * корпус, носик тремя внешними сторонами, три ячейки, молния поверх.
 */
function batterySvg({ hex = HIGH.hex, soft = HIGH.soft, cells = 3, bolt = false } = {}) {
  const g = GEOMETRY;
  const cellY = g.body.y + g.cell.insetY;
  const cellH = g.body.h - g.cell.insetY * 2;
  const cellX = (index) => g.body.x + g.cell.insetX + index * (g.cell.w + g.cell.gap);
  const nubY = g.body.y + (g.body.h - g.nub.h) / 2;
  const nubX = g.body.x + g.body.w;

  const nub =
    `M${nubX} ${nubY} h${g.nub.w - g.nub.rx}` +
    ` a${g.nub.rx} ${g.nub.rx} 0 0 1 ${g.nub.rx} ${g.nub.rx}` +
    ` v${g.nub.h - g.nub.rx * 2}` +
    ` a${g.nub.rx} ${g.nub.rx} 0 0 1 ${-g.nub.rx} ${g.nub.rx}` +
    ` h${-(g.nub.w - g.nub.rx)}`;

  const cellRects = [0, 1, 2]
    .map((index) => {
      const filled = index < cells;
      return (
        `<rect x="${cellX(index)}" y="${cellY}" width="${g.cell.w}" height="${cellH}" rx="${g.cell.rx}"` +
        ` fill="${filled ? 'url(#grad)' : 'none'}" stroke="currentColor"` +
        ` stroke-width="${filled ? 0 : g.stroke * 0.75}" opacity="${filled ? 1 : 0.45}" />`
      );
    })
    .join('');

  return `<svg viewBox="0 0 ${g.viewWidth} ${g.viewHeight}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${soft}" />
      <stop offset="100%" stop-color="${hex}" />
    </linearGradient>
  </defs>
  <rect x="${g.body.x}" y="${g.body.y}" width="${g.body.w}" height="${g.body.h}" rx="${g.body.rx}" stroke="currentColor" stroke-width="${g.stroke}" />
  <path d="${nub}" stroke="currentColor" stroke-width="${g.stroke}" stroke-linecap="round" />
  ${cellRects}
  ${bolt ? `<path d="${BOLT_PATH}" fill="${BG}" stroke="currentColor" stroke-width="${g.stroke * 0.9}" stroke-linejoin="round" />` : ''}
</svg>`;
}

/**
 * Свечение из .battery--glow (src/components/BatteryIcon.css), но радиусы в долях
 * ширины, а не в пикселях. В приложении батарея живёт в диапазоне от 22 до ~120
 * пикселей, и фиксированные 2/7/20 там честны; на иконке в 512 те же двадцать
 * пикселей превратились бы в еле заметную кайму, а на 32 — в сплошное пятно.
 */
function glowFilter(width) {
  const [near, mid, far] = [0.022, 0.065, 0.17].map((share) => (width * share).toFixed(2));
  return `drop-shadow(0 0 ${near}px currentColor) drop-shadow(0 0 ${mid}px currentColor) drop-shadow(0 0 ${far}px currentColor)`;
}

/**
 * Тот же квадрат, что и у растровых иконок, только вектором: Chromium ему не
 * нужен, это тот же шаблон без растеризации.
 *
 * Свечения нет намеренно — фавикон живёт в шестнадцати пикселях вкладки, где
 * размытая зелёная клякса читается хуже чистого контура.
 */
function faviconSvg(inset = 0.14) {
  const side = GEOMETRY.viewWidth;
  const scale = 1 - inset * 2;
  const dx = (side - GEOMETRY.viewWidth * scale) / 2;
  const dy = (side - GEOMETRY.viewHeight * scale) / 2;
  const inner = batterySvg()
    .replace(/^<svg[^>]*>\s*|\s*<\/svg>$/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}" width="${side}" height="${side}">
  <rect width="${side}" height="${side}" fill="${BG}" />
  <g transform="translate(${dx.toFixed(2)} ${dy.toFixed(2)}) scale(${scale})" color="${HIGH.hex}">
    ${inner}
  </g>
</svg>
`;
}

function iconHtml({ size, inset, glow }) {
  const width = size * (1 - inset * 2);
  return `<!doctype html><meta charset="utf-8" />
<style>
  html, body { margin: 0; background: ${BG}; }
  #art {
    width: ${size}px; height: ${size}px; background: ${BG};
    display: flex; align-items: center; justify-content: center; overflow: hidden;
  }
  #art svg {
    width: ${width}px; color: ${HIGH.hex};
    ${glow ? `filter: ${glowFilter(width)};` : ''}
  }
</style>
<div id="art">${batterySvg()}</div>`;
}

/**
 * Превью ссылки. Читаться должно в размере ногтя, поэтому всё по центру и
 * крупно: батарея, название, одна строка сути. Внизу — подпись капсом между
 * двумя линиями: приём из .divider-label и BatteryCaption, самая узнаваемая
 * деталь оформления после самой батареи.
 */
function ogHtml({ width, height }) {
  const batteryWidth = 300;
  return `<!doctype html><meta charset="utf-8" />
<style>
  html, body { margin: 0; background: ${BG}; }
  #art {
    width: ${width}px; height: ${height}px; background: ${BG};
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 34px; font-family: ${FONT}; color: ${TEXT}; overflow: hidden;
  }
  #art svg { width: ${batteryWidth}px; color: ${HIGH.hex}; filter: ${glowFilter(batteryWidth)}; }
  .title { font-size: 68px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
  .sub { font-size: 30px; color: ${TEXT_DIM}; line-height: 1.3; }
  .rule {
    display: flex; align-items: center; gap: 18px; width: 620px; margin-top: 8px;
    font-size: 15px; font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.18em; color: ${TEXT_FAINT};
  }
  .rule::before, .rule::after { content: ''; flex: 1; height: 1px; background: ${HAIRLINE}; }
</style>
<div id="art">
  ${batterySvg()}
  <div class="title">Мои Приоритеты</div>
  <div class="sub">Куда на самом деле уходит время и личная энергия</div>
  <div class="rule">Один клик — полчаса жизни</div>
</div>`;
}

/**
 * Запись только при изменении: рендер Chromium детерминирован, а переписывание
 * семи файлов на каждом прогоне превратило бы git status в шум, в котором
 * настоящее изменение не найти. Приём взят из capture.mjs.
 */
function writeIfChanged(relative, buffer) {
  const file = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buffer)) return false;
  fs.writeFileSync(file, buffer);
  return true;
}

async function shoot(page, html, size) {
  await page.setViewportSize(size);
  await page.setContent(html, { waitUntil: 'load' });
  return page.locator('#art').screenshot({ type: 'png' });
}

async function main() {
  /*
   * Playwright подгружается здесь, а не строкой import наверху, чтобы модуль
   * оставался импортируемым без него: tools/brand.test.ts сверяет копию
   * геометрии обычным npm test, а в корне playwright не стоит и стоять не должен.
   */
  const { chromium } = await import('playwright');

  const browser = await chromium.launch();
  let total = 0;
  let changed = 0;

  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });

    for (const icon of ICONS) {
      const buffer = await shoot(page, iconHtml(icon), { width: icon.size, height: icon.size });
      for (const out of icon.out) {
        total += 1;
        const isNew = writeIfChanged(out, buffer);
        if (isNew) changed += 1;
        log(`  ${isNew ? '~' : '='} ${out}`);
      }
    }

    const og = await shoot(page, ogHtml(OG), { width: OG.width, height: OG.height });
    for (const out of OG.out) {
      total += 1;
      const isNew = writeIfChanged(out, og);
      if (isNew) changed += 1;
      log(`  ${isNew ? '~' : '='} ${out}`);
    }
  } finally {
    await browser.close();
  }

  const svg = Buffer.from(faviconSvg(), 'utf8');
  for (const out of SVG_ICONS) {
    total += 1;
    const isNew = writeIfChanged(out, svg);
    if (isNew) changed += 1;
    log(`  ${isNew ? '~' : '='} ${out}`);
  }

  log(`\nГотово: ${total}, изменилось ${changed}.`);
}

/* Рисуем только при прямом запуске: импорт из теста не должен поднимать браузер. */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
