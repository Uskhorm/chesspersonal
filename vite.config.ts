import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves from /<repo>/; Vercel and local dev serve from /.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
