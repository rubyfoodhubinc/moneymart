/// <reference types="vite/client" />

/** Client-visible environment, populated from apps/web/.env* at build time. */
interface ImportMetaEnv {
  /** MoneyMart API origin (REST + WebSocket). */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
