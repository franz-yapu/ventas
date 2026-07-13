import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://ventafacil:cambia_esto_en_produccion@localhost:5432/ventafacil',
  },
  casing: 'snake_case',
});
