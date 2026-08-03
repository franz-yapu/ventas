import postgres from 'postgres';

/**
 * Conexión como dueño de las tablas. Activar o quitar RLS es una operación de
 * esquema: el rol de la app no puede (ni debe poder) hacerla.
 */
const ownerUrl =
  process.env.OWNER_DATABASE_URL ??
  'postgres://ventafacil:cambia_esto_en_produccion@localhost:5434/ventafacil_test';

let client: ReturnType<typeof postgres> | null = null;

function owner() {
  client ??= postgres(ownerUrl, { max: 1 });
  return client;
}

export async function runAsOwner(statements: string[]) {
  // Los `drop policy if exists` emiten NOTICE en cada corrida; sólo ensucian la salida.
  await owner().unsafe('set client_min_messages to warning');
  for (const stmt of statements) await owner().unsafe(stmt);
}

export async function closeOwner() {
  await client?.end();
  client = null;
}
