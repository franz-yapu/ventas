import { slugDesdeNombre, validarSlug, MENSAJE_SLUG } from '@ventafacil/shared';
import argon2 from 'argon2';
import { queryClient } from './client.js';
import { crearNegocio, slugDisponible } from './create-tenant.js';

// Alta de un negocio desde la consola. Desde la #6 existe también la pantalla de
// registro; las dos usan la MISMA función (`crearNegocio`), así que no pueden
// divergir y crear negocios distintos.
//
//   pnpm new-tenant "<Nombre del negocio>" <adminUser> <adminPass> [slug] [email]
const [name, username, password, slugArg, email] = process.argv.slice(2);
if (!name || !username || !password) {
  console.error(
    'Uso: pnpm new-tenant "<Nombre del negocio>" <adminUser> <adminPass> [slug] [email]',
  );
  process.exit(1);
}

const slug = slugArg ?? slugDesdeNombre(name);

async function main() {
  const problema = validarSlug(slug);
  if (problema) {
    console.error(`Subdominio "${slug}" no válido: ${MENSAJE_SLUG[problema]}`);
    process.exit(1);
  }
  if (!(await slugDisponible(slug))) {
    console.error(`El subdominio "${slug}" ya está en uso.`);
    process.exit(1);
  }

  await crearNegocio({
    name: name!,
    slug,
    adminName: 'Administrador',
    adminUsername: username!,
    adminPasswordHash: await argon2.hash(password!),
    adminEmail: email ?? null,
  });

  console.log(`✓ Negocio "${name}" creado con sucursal "Principal". Admin: ${username}`);
  console.log(`  Subdominio: ${slug} · en prueba gratis`);
  if (!email) {
    console.log('  ⚠ Sin correo: este admin no podrá recuperar su contraseña solo.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
