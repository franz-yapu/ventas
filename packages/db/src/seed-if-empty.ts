// Siembra los datos demo SOLO si la base está vacía (sin ningún negocio).
// Se usa al arrancar el contenedor: idempotente ante reinicios.
import { db, queryClient } from './client.js';
import { business } from './schema.js';

const existing = await db.select({ id: business.id }).from(business).limit(1);
if (existing.length > 0) {
  console.log('✓ La base ya tiene datos: se omite el seed.');
  await queryClient.end();
} else {
  console.log('Base vacía: sembrando datos demo…');
  // seed.js ejecuta su main() al importarse y cierra la conexión al terminar.
  await import('./seed.js');
}
