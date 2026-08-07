/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Тесты покрывают только чистую логику агрегации и сериализации, DOM им не нужен.
  //
  // tools/ добавлен ради проверки связности документации: она ходит по файловой
  // системе, а значит требует типов Node. В src/ этот тест заставил бы добавить
  // "node" в tsconfig приложения — и Node API стали бы видны продуктовому коду,
  // которому их видеть незачем.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
  plugins: [react()],
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
