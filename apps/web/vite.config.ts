import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * MoneyMart web — Vite configuration.
 *
 * Environment note (see docs/ENVIRONMENT.md): this machine's macOS Library
 * Validation refuses to map linker-signed native addons into the Node process,
 * which breaks Next.js's SWC binary and Rollup's native binding. Vite's dev
 * pipeline is pure esbuild + JS and runs fine; for bundling we alias `rollup`
 * to `@rollup/wasm-node`, the official WebAssembly build, which is a drop-in
 * replacement with the same API.
 */
export default defineConfig({
  plugins: [react()],
  // Tailwind is applied by the PostCSS pipeline (postcss.config.mjs) so the
  // Rust compiler runs on its WebAssembly build in this environment.
  css: { postcss: './postcss.config.mjs' },
  resolve: {
    alias: [
      // Bundler: WebAssembly Rollup instead of the linker-signed native binding.
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
      {
        find: '@moneymart/tokens/css',
        replacement: fileURLToPath(new URL('../../packages/tokens/tokens.css', import.meta.url)),
      },
      { find: '@moneymart/tokens', replacement: fileURLToPath(new URL('../../packages/tokens/src/index.ts', import.meta.url)) },
      { find: '@moneymart/types', replacement: fileURLToPath(new URL('../../packages/types/src/index.ts', import.meta.url)) },
    ],
  },
  server: {
    port: 3000,
    host: '127.0.0.1',
    strictPort: true,
    // Fast Refresh for React, instant HMR for CSS.
    hmr: { overlay: true },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      // Keep the WebAssembly bundler in charge of the whole build.
      maxParallelFileOps: 4,
    },
  },
  optimizeDeps: {
    // @rollup/wasm-node is a build-time dependency; keep it out of the browser graph.
    exclude: ['@rollup/wasm-node'],
    include: ['socket.io-client', 'react-router-dom', '@tanstack/react-query', 'zustand'],
  },
});
