# VentaFácil — POS multi-sucursal white-label

Sistema de punto de venta genérico (llantas, repuestos, cualquier negocio mediano),
offline-first, multi-tenant y personalizable por cliente. Optimizado para VPS chico
(Hostinger KVM1). Ver `PLAN_PROYECTO_POS.md` (plan maestro) y `DECISIONS.md` (decisiones).

## Requisitos
- Node 22+, pnpm 11+, Docker + Docker Compose.

## Puesta en marcha (desarrollo)

```bash
pnpm install
cp .env.example .env            # ya viene con valores de dev

# 1) Base de datos (Postgres 16 en el puerto host 5434)
pnpm docker:up

# 2) Migrar + sembrar datos demo
set -a && . ./.env && set +a
pnpm db:migrate
pnpm db:seed

# 3) API (http://localhost:3000) y Web (http://localhost:5173) en dos terminales
pnpm --filter @ventafacil/api dev
pnpm --filter @ventafacil/web dev
```

Abrir http://localhost:5173 e ingresar con:
- **admin / admin123** (administrador)
- **vendedor / vende123** (vendedor)

## Comandos útiles
- `pnpm db:studio` — explorar la BD con Drizzle Studio.
- `pnpm new-tenant "<Negocio>" <adminUser> <adminPass>` — crear un cliente nuevo.
- `pnpm db:generate` — generar migración tras cambiar el esquema.

## Estructura
- `apps/web` — PWA React (POS + Admin).
- `apps/api` — API Fastify.
- `packages/db` — esquema Drizzle + migraciones + seed.
- `packages/shared` — esquemas Zod y constantes compartidas (front + back).

## Notas de despliegue (VPS KVM1)
- El frontend se despliega en Cloudflare Pages; el API como imagen Docker (compilada en CI/local).
- Nunca compilar en el VPS. Activar 2 GB de swap y backups `pg_dump` fuera del servidor.
