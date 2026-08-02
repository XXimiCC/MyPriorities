/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Тесты покрывают только чистую логику агрегации и сериализации, DOM им не нужен.
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
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
