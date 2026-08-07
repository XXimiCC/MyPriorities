---
title: Локальный запуск
---

# Локальный запуск

## Приложение

```bash
npm install
npm run dev          # http://localhost:5173
npm run test         # агрегация периодов, сериализация, лестница, достижения
npm run build        # tsc --noEmit + сборка в dist/
```

В обычном браузере SDK Telegram отсутствует: обёртка отдаёт заглушки, а хранилище
само переключается на `localStorage`. Приложение при этом полностью работоспособно —
см. [«Только в Telegram»](/topics/telegram-only).

Для данных, на которых видно недельные и месячные окна, добавьте
[`?mock=1`](/dev/mock).

## Документация

```bash
npm run docs:dev     # http://localhost:5173 — сайт документации
npm run docs:build   # сборка в docs/.vitepress/dist
npm run docs:serve   # просмотр собранного
```

VitePress живёт в `docs/package.json` со своим `node_modules`, а не в корневом:
у документации свой проект на Vercel с Root Directory = `docs`, и он видит только
эту папку.

## Скриншоты

```bash
npm run shots:setup  # один раз: playwright + chromium (~150 МБ)
npm run docs:shots   # пересобрать все снимки
```

Playwright тоже вынесен в собственный `tools/shots/package.json` — его
install-скрипт качает браузеры, и в корне это добавлялось бы к **каждой** сборке
приложения. Подробности — в [«Скриншотах»](/dev/screenshots).

## На реальном устройстве

Мини-приложение открывается только по HTTPS, поэтому dev-сервер прокидывается
туннелем:

```bash
npx cloudflared tunnel --url http://localhost:5173
```

Полученный адрес указывается в BotFather как Mini App URL — см.
[«Сборка и публикация»](/dev/release). `allowedHosts: true` в `vite.config.ts`
уже разрешает произвольный хост туннеля.

## Что стоит знать про конфигурацию

- **`tsconfig.json` включает только `src`.** Ни `docs/`, ни `tools/` в
  `tsc --noEmit` не попадают, поэтому сборка приложения от них не зависит.
- **Vitest ограничен `src/**/*.test.ts`.** Тест, положенный вне `src`, просто не
  запустится.
- **`base: './'`** в `vite.config.ts` — пути относительные, подойдёт любой
  статический хостинг.
- **Приложение только тёмное.** Тема Telegram игнорируется намеренно: на светлом
  фоне неон не читается вовсе.

## Рядом

[Демо-режим](/dev/mock) · [Архитектура](/dev/architecture) ·
[Скриншоты](/dev/screenshots) · [Сборка и публикация](/dev/release)
