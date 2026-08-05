/**
 * Alta de un operador del panel de plataforma.
 *
 *   pnpm --filter @ventafacil/db new-platform-admin <email> "<Nombre>" <contraseña> [--owner]
 *
 * Con `--owner` el operador queda como PRINCIPAL: el único perfil que puede dar de alta,
 * desactivar o cambiarle la contraseña a otro operador desde el panel.
 *
 * El primer principal se crea aquí y no por pantalla a propósito: quien puede crear
 * operadores puede ver y suspender a todos los clientes. Que haga falta acceso al
 * servidor para abrir esa puerta la primera vez es parte de la protección — y es
 * también la salida si te quedas fuera, porque este mismo comando cambia la contraseña
 * de un operador que ya existe.
 */
import argon2 from 'argon2';
import { eq } from 'drizzle-orm';
import { db, queryClient } from './client.js';
import * as s from './schema.js';

const args = process.argv.slice(2);
const owner = args.includes('--owner');
const [emailArg, name, password] = args.filter((a) => a !== '--owner');
if (!emailArg || !name || !password) {
  console.error(
    'Uso: pnpm --filter @ventafacil/db new-platform-admin <email> "<Nombre>" <contraseña> [--owner]',
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
    // `--owner` sólo asciende, nunca degrada: quitar el rango es una decisión que se
    // toma mirando quién más lo tiene, y eso se hace desde el panel, no a ciegas aquí.
    await db
      .update(s.platformAdmin)
      .set({ passwordHash, name: name!, isActive: true, ...(owner ? { isOwner: true } : {}) })
      .where(eq(s.platformAdmin.id, existente.id));
    console.log(
      `✓ Operador "${email}" actualizado (contraseña nueva y cuenta activa)` +
        (owner ? ', ahora es PRINCIPAL.' : '.'),
    );
    return;
  }

  await db.insert(s.platformAdmin).values({ email, name: name!, passwordHash, isOwner: owner });
  console.log(`✓ Operador de plataforma creado: ${email}${owner ? ' (PRINCIPAL)' : ''}`);
  console.log('  Entra por el subdominio admin de tu dominio, en /plataforma.');
  if (!owner) {
    console.log('  Sin --owner no podrá crear ni desactivar a otros operadores.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
