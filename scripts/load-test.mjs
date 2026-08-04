/**
 * Prueba de carga contra el staging local.
 *
 * Existe para responder UNA pregunta con un número en vez de una corazonada: **cuántos
 * negocios activos aguanta el VPS antes de que la app se sienta lenta.** El staging
 * imita al servidor a propósito (1 vCPU, `max_connections=20`, `DB_POOL_MAX=8`,
 * `NODE_ENV=production`), así que lo que salga aquí se parece a lo que pasará allí.
 *
 *   node scripts/load-test.mjs                 # rampa por defecto
 *   node scripts/load-test.mjs --cajas 5,10,20 --segundos 30
 *
 * Simula CAJAS, no peticiones sueltas: cada caja hace lo que hace una de verdad —mirar
 * el catálogo, listar sus ventas, cobrar— porque medir 10.000 peticiones a `/health`
 * no dice nada sobre si el negocio podrá vender.
 *
 * ⚠️ Necesita el tope global de peticiones subido (`RATE_LIMIT_MAX`), o mide el
 * limitador en lugar del servidor: toda la carga sale de una sola IP.
 */
import { randomUUID } from 'node:crypto';

const API = process.env.API_URL ?? 'http://localhost:3100/api/v1';

function arg(nombre, porDefecto) {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : porDefecto;
}

const RAMPA = arg('cajas', '2,5,10,20,40').split(',').map(Number);
const SEGUNDOS = Number(arg('segundos', 20));
/**
 * Segundos de espera entre ciclos de una misma caja. Con 0 se mide el TECHO del
 * servidor; con un valor realista (una venta cada pocos segundos) se mide cuántas
 * cajas simultáneas aguanta sin que nadie note lentitud. Son dos preguntas distintas.
 */
const PAUSA = Number(arg('pausa', 0));
const PREFIJO = 'carga';

async function json(path, { method = 'GET', body, token } = {}) {
  const t0 = performance.now();
  const res = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = performance.now() - t0;
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }
  return { status: res.status, data, ms };
}

/** Percentil sobre una lista YA ordenada. */
function pct(ordenados, p) {
  if (ordenados.length === 0) return 0;
  const i = Math.min(ordenados.length - 1, Math.floor((p / 100) * ordenados.length));
  return ordenados[i];
}

/** Da de alta un negocio con un producto listo para vender. */
async function crearCaja(n) {
  const slug = `${PREFIJO}-${Date.now().toString(36)}-${n}`;
  const alta = await json('/register', {
    method: 'POST',
    body: {
      businessName: `Carga ${n}`,
      slug,
      adminName: 'Cajero',
      email: `c${n}@${slug}.test`,
      username: 'cajero',
      password: 'clave-de-carga-1',
      acceptTerms: true,
    },
  });
  if (alta.status !== 201) throw new Error(`alta ${slug}: ${alta.status} ${JSON.stringify(alta.data)}`);

  const login = await json('/auth/login', {
    method: 'POST',
    body: { username: 'cajero', password: 'clave-de-carga-1', business: slug },
  });
  const token = login.data.data.accessToken;

  const locs = await json('/locations', { token });
  const locationId = locs.data.data[0].id;

  const prod = await json('/products', {
    method: 'POST',
    token,
    body: { name: 'Producto de carga', price: '25.00', initialStock: 1_000_000, locationId },
  });
  if (prod.status !== 201) throw new Error(`producto: ${prod.status}`);

  return { slug, token, locationId, productId: prod.data.data.id };
}

/**
 * Un ciclo de caja: dos lecturas y una venta.
 *
 * La proporción no es casual: en un mostrador se mira el catálogo y el historial muchas
 * más veces de las que se cobra.
 */
async function ciclo(caja, medir) {
  medir(await json('/products?page=1&limit=50', { token: caja.token }));
  medir(await json('/sales?page=1&limit=20', { token: caja.token }));

  const precio = 25;
  const cantidad = 1 + Math.floor(Math.random() * 3);
  const total = (precio * cantidad).toFixed(2);
  medir(
    await json('/sales', {
      method: 'POST',
      token: caja.token,
      body: {
        id: randomUUID(),
        locationId: caja.locationId,
        subtotal: total,
        discount: '0',
        total,
        paymentMethod: 'cash',
        status: 'completed',
        clientCreatedAt: new Date().toISOString(),
        items: [
          {
            productId: caja.productId,
            productNameSnapshot: 'Producto de carga',
            unitPriceSnapshot: precio.toFixed(2),
            quantity: cantidad,
            lineTotal: total,
          },
        ],
      },
    }),
  );
}

async function fase(cajas, segundos) {
  const latencias = [];
  const porEstado = new Map();
  let peticiones = 0;
  const medir = (r) => {
    peticiones++;
    latencias.push(r.ms);
    porEstado.set(r.status, (porEstado.get(r.status) ?? 0) + 1);
  };

  const hasta = Date.now() + segundos * 1000;
  const t0 = performance.now();
  await Promise.all(
    cajas.map(async (caja) => {
      while (Date.now() < hasta) {
        try {
          await ciclo(caja, medir);
        } catch {
          medir({ status: 0, ms: 0 });
        }
        if (PAUSA > 0) await new Promise((r) => setTimeout(r, PAUSA * 1000));
      }
    }),
  );
  const duracion = (performance.now() - t0) / 1000;

  latencias.sort((a, b) => a - b);
  const errores = [...porEstado.entries()]
    .filter(([s]) => s === 0 || s >= 400)
    .reduce((a, [, n]) => a + n, 0);

  return {
    cajas: cajas.length,
    peticiones,
    rps: peticiones / duracion,
    p50: pct(latencias, 50),
    p95: pct(latencias, 95),
    p99: pct(latencias, 99),
    max: latencias.at(-1) ?? 0,
    errores,
    pctErrores: (errores / peticiones) * 100,
    estados: Object.fromEntries(porEstado),
  };
}

async function main() {
  const maximo = Math.max(...RAMPA);
  process.stdout.write(`Creando ${maximo} negocios de prueba…\n`);
  const cajas = [];
  for (let i = 0; i < maximo; i++) {
    cajas.push(await crearCaja(i));
    if ((i + 1) % 10 === 0) process.stdout.write(`  ${i + 1}/${maximo}\n`);
  }

  console.log(`\nCada fase dura ${SEGUNDOS}s. Cada caja: 2 lecturas + 1 venta por ciclo.\n`);
  console.log('cajas │ req/s │  p50   │  p95   │  p99   │  máx   │ errores');
  console.log('──────┼───────┼────────┼────────┼────────┼────────┼─────────');

  const filas = [];
  for (const n of RAMPA) {
    const r = await fase(cajas.slice(0, n), SEGUNDOS);
    filas.push(r);
    console.log(
      `${String(r.cajas).padStart(5)} │ ${r.rps.toFixed(1).padStart(5)} │ ` +
        `${r.p50.toFixed(0).padStart(5)}ms │ ${r.p95.toFixed(0).padStart(5)}ms │ ` +
        `${r.p99.toFixed(0).padStart(5)}ms │ ${r.max.toFixed(0).padStart(5)}ms │ ` +
        `${r.errores} (${r.pctErrores.toFixed(1)}%)`,
    );
    if (r.errores > 0) console.log(`        estados: ${JSON.stringify(r.estados)}`);
    // Un respiro entre fases para que el servidor no arrastre la cola de la anterior.
    await new Promise((res) => setTimeout(res, 3000));
  }

  console.log(`\nNegocios creados con el prefijo "${PREFIJO}-". Para borrarlos:`);
  console.log(
    `  docker exec vf-staging-db psql -U ventafacil -d ventafacil -c "delete from business where slug like '${PREFIJO}-%';"`,
  );
  return filas;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
