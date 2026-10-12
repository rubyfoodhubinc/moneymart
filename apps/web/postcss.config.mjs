/**
 * MoneyMart — PostCSS pipeline.
 *
 * Tailwind v4 runs through @tailwindcss/postcss. Its Rust components are routed
 * to their official WebAssembly builds (see docs/ENVIRONMENT.md and the shims in
 * node_modules/.pnpm/lightningcss*), because macOS Library Validation blocks the
 * linker-signed native addons on this machine.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
