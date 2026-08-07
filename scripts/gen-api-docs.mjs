/**
 * Genera `docs/API.md` a partir de las rutas REALES de la aplicación.
 *
 *   pnpm docs:api
 *
 * Tiene que correr con `tsx`, no con `node`: importa el árbol de rutas del código
 * TypeScript sin compilar. Con `node` pelado falla con un module-not-found — y si alguien
 * manda ese error a /dev/null, el archivo se queda como estaba y parece que no había nada
 * que regenerar. Pasó: llevó a dar por bueno un `docs/API.md` al que le faltaban nueve
 * rutas. Por eso hay un script en la raíz y un paso de CI que lo comprueba.
 *
 * Se genera en vez de escribirse a mano por un motivo concreto: una lista de endpoints
 * escrita a mano se queda desactualizada en una semana, y entonces es peor que no
 * tenerla — manda a quien la lee a rutas que ya no existen.
 *
 * Lo que NO documenta: cuerpos y respuestas. La validación de este proyecto vive en
 * esquemas de Zod dentro de cada handler, no en esquemas JSON de Fastify, así que
 * Fastify no los conoce. Documentarlos exigiría cablear los 60+ endpoints uno a uno;
 * mientras tanto el contrato está en `packages/shared/src/schemas.ts`, que es una sola
 * fuente y se lee mejor que cualquier copia.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Anclado a la raíz del repo: se ejecuta desde `apps/api` (que es donde está tsx) y
// sin esto escribía el archivo dentro del paquete.
const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');

// El cliente de base de datos exige la variable al importarse. Aquí no se conecta a
// nada: sólo se recorre el árbol de rutas.
process.env.DATABASE_URL ??= 'postgres://noop:noop@localhost:5432/noop';
process.env.NODE_ENV = 'test';

const { buildApp } = await import(join(RAIZ, 'apps/api/src/app.ts'));

/**
 * Convierte el árbol de `printRoutes` en una lista plana.
 *
 * El árbol viene así, y las rutas hijas heredan el camino de su padre:
 *
 *   ├── /api/v1/auth/sessions (GET, HEAD)
 *   │   └── /revoke-all (POST)
 *
 * La profundidad se lee de la sangría: cada nivel son cuatro caracteres.
 */
function aplanar(arbol) {
  const rutas = [];
  const porNivel = [];

  for (const linea of arbol.split('\n')) {
    const m = /^([\s│]*)(?:├──|└──)\s(.*)$/.exec(linea);
    if (!m) continue;
    const nivel = Math.floor(m[1].length / 4);
    const resto = m[2];

    const conMetodos = /^(.*?)\s+\(([A-Z, ]+)\)\s*$/.exec(resto);
    const camino = (conMetodos ? conMetodos[1] : resto).trim();
    porNivel[nivel] = camino;
    const completo = porNivel.slice(0, nivel + 1).join('');

    if (!conMetodos) continue;
    for (const metodo of conMetodos[2].split(',').map((x) => x.trim())) {
      // HEAD lo añade Fastify solo por cada GET; listarlo sólo duplica la tabla.
      if (metodo === 'HEAD') continue;
      rutas.push({ method: metodo, url: completo });
    }
  }
  return rutas;
}

/** Módulo al que pertenece una ruta, deducido de su primer segmento. */
function grupoDe(url) {
  const p = url.replace(/^\/api\/v1\//, '').split('/')[0];
  return (
    {
      auth: 'Sesión y contraseña',
      register: 'Registro de negocios',
      platform: 'Panel de plataforma',
      subscription: 'Suscripción',
      plans: 'Suscripción',
      business: 'Negocio y datos',
      products: 'Catálogo',
      categories: 'Catálogo',
      inventory: 'Inventario',
      locations: 'Sucursales',
      users: 'Usuarios',
      customers: 'Clientes y fiado',
      sales: 'Ventas',
      cash: 'Caja / arqueo',
      reports: 'Reportes',
      audit: 'Actividad',
      health: 'Operación',
    }[p] ?? 'Otros'
  );
}

/** Rutas que NO exigen sesión. Todo lo demás sí. */
const PUBLICAS = new Set([
  'GET /health',
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/register',
  'GET /api/v1/register/slug',
  'GET /api/v1/plans',
  'POST /api/v1/platform/login',
]);

function generar(lista) {
  const porGrupo = new Map();
  for (const r of lista) {
    const g = grupoDe(r.url);
    if (!porGrupo.has(g)) porGrupo.set(g, []);
    porGrupo.get(g).push(r);
  }

  let md = `# API de VentaFácil

> **Generado** por \`scripts/gen-api-docs.mjs\` a partir de las rutas reales de la
> aplicación. No lo edites a mano: vuelve a generarlo.

## Cómo hablar con esta API

Todo cuelga de \`/api/v1\`. Toda respuesta —también los errores— tiene la misma forma:

\`\`\`json
{ "data": {}, "error": null }
\`\`\`

Cuando algo falla, \`data\` es \`null\` y \`error\` trae un mensaje **en español, escrito
para la persona que lo va a leer**, no para el programador.

### Autenticación

Cabecera \`Authorization: Bearer <token>\` en todo lo que no esté marcado como público.
Hay **dos mundos de tokens, firmados con secretos distintos**:

| | Token de negocio | Token de plataforma |
|---|---|---|
| Se obtiene en | \`POST /auth/login\` | \`POST /platform/login\` |
| Firma | \`JWT_ACCESS_SECRET\` | \`JWT_PLATFORM_SECRET\` |
| Dura | 15 min, renovable con el refresh | 8 h, sin renovación |
| Sirve para | el POS de un negocio | administrar todos los negocios |

Uno **no vale** en el mundo del otro, y no por comprobar un campo: son llaves distintas.

### Códigos que conviene distinguir

| Código | Qué significa | Qué hacer |
|---|---|---|
| \`401\` | Sesión caducada o revocada | Renovar con \`/auth/refresh\`; si falla, volver a entrar |
| \`402\` | La suscripción no deja | **No es un problema de sesión.** Ver \`code\` |
| \`403\` | El rol o la ubicación no alcanzan | Nada que reintentar |
| \`429\` | Demasiadas peticiones | Esperar lo que diga el mensaje |

En los \`402\` el campo \`code\` dice cuál de los tres casos es: \`subscription_blocked\`
(prueba vencida, suspendida o cancelada), \`plan_limit\` (se agotó el cupo de sucursales,
usuarios o productos) o \`plan_feature\` (la función no entra en el plan).

Confundir un \`402\` con un \`401\` es el error clásico: el cliente intenta renovar la
sesión, falla, y echa al usuario al login en vez de enseñarle por qué está bloqueado.

### Los cuerpos de las peticiones

Se validan con Zod en \`packages/shared/src/schemas.ts\`. Es una sola fuente, la comparten
el servidor y la web, y se lee mejor que cualquier copia que hiciéramos aquí.

---

## Endpoints (${lista.length})

`;

  for (const g of [...porGrupo.keys()].sort()) {
    md += `### ${g}\n\n| Método | Ruta | Sesión |\n|---|---|---|\n`;
    for (const r of porGrupo.get(g).sort((a, b) => a.url.localeCompare(b.url))) {
      const publica = PUBLICAS.has(`${r.method} ${r.url}`);
      md += `| \`${r.method}\` | \`${r.url}\` | ${publica ? '— pública' : 'requerida'} |\n`;
    }
    md += '\n';
  }

  /*
    Sin sello de fecha, a propósito.

    Con la fecha del día, el archivo cambia cada vez que se regenera aunque no se haya
    tocado una sola ruta — y el paso de CI que comprueba que está al día fallaría cada
    mañana por un motivo falso. Un CI que falla por algo que no importa enseña a
    ignorarlo. Cuándo cambió ya lo dice el historial de git, que además no se equivoca.
  */
  return md;
}

const app = await buildApp({ logger: false });
await app.ready();
const rutas = aplanar(app.printRoutes({ commonPrefix: false }));
await app.close();

mkdirSync(join(RAIZ, 'docs'), { recursive: true });
writeFileSync(join(RAIZ, 'docs/API.md'), generar(rutas));
console.log(`✓ docs/API.md con ${rutas.length} endpoints`);
