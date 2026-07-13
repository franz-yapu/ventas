import argon2 from 'argon2';
import { db, queryClient } from './client.js';
import * as s from './schema.js';

// Onboarding rapido de un negocio nuevo: pnpm new-tenant "Nombre" adminUser adminPass
// (Fase 4 lo conecta a una pantalla; aqui queda la base CLI para crear tenants en minutos.)
const [name, username, password] = process.argv.slice(2);
if (!name || !username || !password) {
  console.error('Uso: pnpm new-tenant "<Nombre del negocio>" <adminUser> <adminPass>');
  process.exit(1);
}

async function main() {
  const [biz] = await db.insert(s.business).values({ name: name! }).returning();
  await db.insert(s.businessCounter).values({ businessId: biz!.id, lastReceiptNumber: 0 });
  // Ubicación central por defecto para que pueda vender de inmediato.
  const [loc] = await db
    .insert(s.location)
    .values({ businessId: biz!.id, name: 'Principal', isCentral: true })
    .returning();
  const hash = await argon2.hash(password!);
  await db.insert(s.appUser).values({
    businessId: biz!.id,
    locationId: loc!.id,
    name: 'Administrador',
    username: username!,
    passwordHash: hash,
    role: 'admin',
  });
  console.log(`✓ Negocio "${name}" creado con ubicación "Principal". Admin: ${username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
