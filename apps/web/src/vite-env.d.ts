/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  // Slug del negocio para instalaciones white-label con varios negocios en una BD.
  readonly VITE_BUSINESS_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
