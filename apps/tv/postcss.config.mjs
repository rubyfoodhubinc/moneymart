/**
 * MoneyMart TV — PostCSS pipeline.
 * Tailwind v4 runs through the WASM routing set up by scripts/ensure-env.sh
 * (see docs/ENVIRONMENT.md); no native addon is loaded.
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
