/**
 * Alta de un operador del panel de plataforma.
 *
 *   pnpm --filter @ventafacil/db new-platform-admin <email> "<Nombre>" <contraseña>
 *
 * Se hace por CLI y no por pantalla a propósito: quien puede crear operadores puede
 * ver y suspender a todos los clientes. Que haga falta acceso al servidor para crear
 * el primero (y los siguientes) es parte de la protección.
 *
 * Si el correo ya existe, se le cambia la contraseña y se reactiva — así este mismo
 * comando sirve para recuperar el acceso si te quedas fuera.
 */
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db, queryClient } from './client.js';
import * as s from './schema.js';

const [emailArg, name, password] = process.argv.slice(2);
if (!emailArg || !name || !password) {
  console.error(
    'Uso: pnpm --filter @ventafacil/db new-platform-admin <email> "<Nombre>" <contraseña>',
  );
  process.exit(1);
}

const email = emailArg.toLowerCase().trim();

if (password.length < 12) {
  // Es la cuenta con más alcance del sistema; 6 caracteres como los usuarios de un
  // negocio no bastan.
  console.error('La contraseña del operador debe tener al menos 12 caracteres.');
  process.exit(1);
}

async function main() {
  const passwordHash = await argon2.hash(password!);
  const [existente] = await db
    .select({ id: s.platformAdmin.id })
    .from(s.platformAdmin)
    .where(eq(s.platformAdmin.email, email))
    .limit(1);

  if (existente) {
    await db
      .update(s.platformAdmin)
      .set({ passwordHash, name: name!, isActive: true })
      .where(eq(s.platformAdmin.id, existente.id));
    console.log(`✓ Operador "${email}" actualizado (contraseña nueva y cuenta activa).`);
    return;
  }

  await db.insert(s.platformAdmin).values({ email, name: name!, passwordHash });
  console.log(`✓ Operador de plataforma creado: ${email}`);
  console.log('  Entra por el subdominio admin de tu dominio, en /plataforma.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
