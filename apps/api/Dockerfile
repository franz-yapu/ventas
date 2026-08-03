# Imagen del API (Fastify) para producción. Se construye en LOCAL/CI y se
# transfiere al VPS (docker save | ssh docker load); nunca se compila en el VPS.
# Ejecuta con tsx (igual que en dev) para evitar el bundling del monorepo pnpm.
# Contexto de build: la RAÍZ del repo.
FROM node:22-bookworm-slim

RUN corepack enable
WORKDIR /app

# Copiamos el workspace completo (menos lo del .dockerignore) para que pnpm
# resuelva el lockfile sin faltantes.
COPY . .

# Sólo dependencias del API y su grafo local (db, shared): evita instalar el
# stack pesado del web (vite, recharts) en la imagen del API.
RUN pnpm install --frozen-lockfile --filter "@ventafacil/api..." --filter "@ventafacil/db..."

RUN chmod +x apps/api/docker-entrypoint.sh

ENV NODE_ENV=production
# El API escucha en 3000 dentro del contenedor (se mapea afuera).
ENV API_PORT=3000
EXPOSE 3000

CMD ["apps/api/docker-entrypoint.sh"]
