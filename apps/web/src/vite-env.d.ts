/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  // Dominio base de la instalación ("localhost" en dev, "tudominio.com" en producción).
  // Es lo que permite leer el negocio del subdominio sin confundirlo con el dominio.
  readonly VITE_APP_DOMAIN?: string;
  // Slug del negocio para instalaciones white-label con varios negocios en una BD.
  readonly VITE_BUSINESS_SLUG?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
