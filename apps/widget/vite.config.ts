import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/widget.ts',
      name: 'MovensaWebchat',
      formats: ['iife'],
      fileName: () => 'movensa-widget.js',
    },
    sourcemap: true,
    minify: 'esbuild',
  },
});
