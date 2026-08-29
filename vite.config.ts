/// <reference types="vitest" />
import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Отметка сборки: коммит и время.
 *
 * Нужна ровно затем, чтобы «доехало ли на прод» был проверяемый вопрос, а не
 * ощущение. На Vercel коммит приходит переменной окружения, локально
 * спрашивается у git; если ни того, ни другого нет — так и написано.
 *
 * Время добавлено к коммиту не для красоты: один и тот же коммит пересобирают,
 * и без времени повторное развёртывание неотличимо от несостоявшегося.
 */
function buildStamp(): { id: string; time: string } {
  const fromCi = process.env.VERCEL_GIT_COMMIT_SHA;
  if (fromCi) return { id: fromCi.slice(0, 7), time: new Date().toISOString() };

  try {
    return {
      id: execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(),
      time: new Date().toISOString(),
    };
  } catch {
    return { id: 'нет', time: new Date().toISOString() };
  }
}

const build = buildStamp();

/** Имя чанка, за которым живёт всё приложение, — см. динамический import() в src/main.tsx. */
const BOOT = 'boot';

/**
 * Ранняя загрузка стартового чанка.
 *
 * Приложение висит за динамическим import(): выполнить его можно только после
 * того, как решится судьба SDK Telegram (src/main.tsx). Но такие куски Vite в
 * разметку не выносит — браузер узнаёт о них лишь выполнив входной модуль, то
 * есть кругом позже. Вместе с чанком опаздывает и весь CSS приложения, который
 * лежит в нём же.
 *
 * Ссылки ставим в <head> сами: чанк и его лист начинают грузиться одновременно
 * со входным модулем, ровно как до разделения. Порядок каскада это не трогает —
 * лист у чанка один, и внутри он собран в порядке импортов boot.tsx.
 */
function preloadBoot(): Plugin {
  return {
    name: 'mypri:preload-boot',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunk = Object.values(ctx.bundle ?? {}).find(
          (item) => item.type === 'chunk' && item.name === BOOT,
        );
        if (chunk?.type !== 'chunk') return html;

        return {
          html,
          tags: [
            {
              tag: 'link',
              attrs: { rel: 'modulepreload', crossorigin: true, href: `./${chunk.fileName}` },
              injectTo: 'head' as const,
            },
            ...[...(chunk.viteMetadata?.importedCss ?? [])].map((file) => ({
              tag: 'link',
              attrs: { rel: 'stylesheet', crossorigin: true, href: `./${file}` },
              injectTo: 'head' as const,
            })),
          ],
        };
      },
    },
  };
}

export default defineConfig({
  // Тесты покрывают только чистую логику агрегации и сериализации, DOM им не нужен.
  //
  // tools/ добавлен ради проверки связности документации: она ходит по файловой
  // системе, а значит требует типов Node. В src/ этот тест заставил бы добавить
  // "node" в tsconfig приложения — и Node API стали бы видны продуктовому коду,
  // которому их видеть незачем.
  // worker/ добавлен по той же причине, что и tools/: его чистая часть —
  // подпись, токены, обвязка над Web Crypto — проверяется обычным node, без
  // поднятия workerd. Всё, что трогает D1, проверяется отдельно, вживую.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts', 'worker/test/**/*.test.ts'],
  },
  define: {
    __BUILD_ID__: JSON.stringify(build.id),
    __BUILD_TIME__: JSON.stringify(build.time),
  },
  plugins: [react(), preloadBoot()],
  base: './',
  server: {
    host: true,
    // Туннели (cloudflared / ngrok) отдают собственный хост — иначе Vite их отклоняет.
    allowedHosts: true,
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
  },
});
