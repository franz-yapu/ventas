import argon2 from 'argon2';
import { db, queryClient } from './client.js';
import * as s from './schema.js';

// Seed inicial: 1 negocio de llantas, 1 sola sucursal (Caranavi), admin + vendedor.
// Sin productos ni stock: la instalación arranca limpia para cargar lo real.
const ATTR_SCHEMA = [
  { key: 'medida', label: 'Medida', type: 'text', required: true },
  { key: 'marca', label: 'Marca', type: 'text', required: false },
];

async function main() {
  console.log('Sembrando datos iniciales...');

  const [biz] = await db
    .insert(s.business)
    .values({
      name: 'Llantas El Rapido',
      slug: 'llantas-el-rapido',
      themeJson: { primary: '#2f68d8', secondary: '#f59e0b', radius: '12px' },
      textsJson: { app_name: 'Llantas El Rapido', receipt_footer: '¡Gracias por su compra!' },
      productSchemaJson: ATTR_SCHEMA,
      currency: 'BOB',
      taxRate: '0',
    })
    .returning();
  const businessId = biz!.id;

  await db.insert(s.businessCounter).values({ businessId, lastReceiptNumber: 0 });

  // Única sucursal. Al ser la única, es central (el admin ve todo). La dirección
  // se completa después desde la app.
  const [caranavi] = await db
    .insert(s.location)
    .values({ businessId, name: 'Caranavi', isCentral: true })
    .returning();
  const caranaviId = caranavi!.id;

  const adminHash = await argon2.hash('caranavi2026');
  const sellerHash = await argon2.hash('vender2026');
  await db.insert(s.appUser).values([
    {
      businessId,
      locationId: caranaviId,
      name: 'Administrador',
      username: 'admin',
      passwordHash: adminHash,
      role: 'admin',
    },
    {
      businessId,
      locationId: caranaviId,
      name: 'Vendedor',
      username: 'vendedor',
      passwordHash: sellerHash,
      role: 'seller',
    },
  ]);

  console.log('✓ Seed completo:');
  console.log('  Negocio: Llantas El Rapido');
  console.log('  Sucursal: Caranavi');
  console.log('  Login admin    -> usuario: admin    / clave: caranavi2026');
  console.log('  Login vendedor -> usuario: vendedor / clave: vender2026');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
