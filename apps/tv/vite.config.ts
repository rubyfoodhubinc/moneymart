import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

/**
 * MoneyMart TV — Vite configuration.
 *
 * One codebase targets Smart TV browsers and IPTV middleware: Samsung Tizen,
 * LG webOS and HbbTV all run a Chromium/WebKit engine, so a standards-based SPA
 * with a D-pad focus engine is the correct distribution vehicle (§7.1).
 */
export default defineConfig(({ command }) => ({
  /**
   * The TV bundle is mounted under /tv by the unified gateway, so production
   * builds must emit /tv/assets/*. Without this both the web and TV bundles
   * claim /assets/ at the root and the TV app silently loads the wrong code.
   * The dev server still runs from the origin root, so the base applies to
   * builds only.
   */
  base: command === 'build' ? '/tv/' : '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@moneymart/tokens/css': fileURLToPath(new URL('../../packages/tokens/tokens.css', import.meta.url)),
      '@moneymart/tokens': fileURLToPath(new URL('../../packages/tokens/src/index.ts', import.meta.url)),
      '@moneymart/types': fileURLToPath(new URL('../../packages/types/src/index.ts', import.meta.url)),
    },
  },
  css: { postcss: './postcss.config.mjs' },
  server: { port: 3200, host: '127.0.0.1', strictPort: true, hmr: { overlay: true } },
  build: { outDir: 'dist', target: 'es2019', sourcemap: true, cssMinify: 'esbuild' },
}));
