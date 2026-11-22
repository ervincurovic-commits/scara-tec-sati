import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5183, strictPort: true },
  preview: { port: 5184, strictPort: true },
  build: { target: 'es2020' },
});
