import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: true },
  build: {
    target: 'es2022',
    // three.js sozinho passa de 500 kB; não é um problema para um jogo.
    chunkSizeWarningLimit: 1500,
  },
});
