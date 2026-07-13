import argon2 from 'argon2';
import { db, queryClient } from './client.js';
import * as s from './schema.js';

// Seed: 1 negocio demo de llantas, 2 ubicaciones, admin + vendedor, 20 productos.
const DEMO_ATTR_SCHEMA = [
  { key: 'medida', label: 'Medida', type: 'text', required: true },
  { key: 'marca', label: 'Marca', type: 'text', required: false },
];

const MEDIDAS = [
  '175/70R13', '185/65R14', '195/60R15', '205/55R16', '215/55R17',
  '225/45R18', '235/60R16', '245/40R19', '255/55R18', '265/70R16',
];
const MARCAS = ['Michelin', 'Bridgestone', 'Goodyear', 'Pirelli', 'Continental'];

async function main() {
  console.log('Sembrando datos demo...');

  const [biz] = await db
    .insert(s.business)
    .values({
      name: 'Llantas El Rapido',
      slug: 'llantas-el-rapido',
      themeJson: { primary: '#2f68d8', secondary: '#f59e0b', radius: '12px' },
      textsJson: { app_name: 'Llantas El Rapido', receipt_footer: '¡Gracias por su compra!' },
      productSchemaJson: DEMO_ATTR_SCHEMA,
      currency: 'BOB',
      taxRate: '0',
    })
    .returning();
  const businessId = biz!.id;

  await db.insert(s.businessCounter).values({ businessId, lastReceiptNumber: 0 });

  const locations = await db
    .insert(s.location)
    .values([
      { businessId, name: 'La Paz (Central)', address: 'Av. Buenos Aires', isCentral: true },
      { businessId, name: 'Sucursal Pueblo', address: 'Plaza principal' },
    ])
    .returning();
  const centralId = locations[0]!.id;
  const puebloId = locations[1]!.id;

  const adminHash = await argon2.hash('admin123');
  const sellerHash = await argon2.hash('vende123');
  await db.insert(s.appUser).values([
    { businessId, locationId: centralId, name: 'Dueño Admin', username: 'admin', passwordHash: adminHash, role: 'admin' },
    {
      businessId,
      locationId: puebloId,
      name: 'Vendedor Pueblo',
      username: 'vendedor',
      passwordHash: sellerHash,
      role: 'seller',
    },
  ]);

  const [cat] = await db
    .insert(s.category)
    .values({ businessId, name: 'Llantas' })
    .returning();

  const productValues = Array.from({ length: 20 }, (_, i) => {
    const medida = MEDIDAS[i % MEDIDAS.length]!;
    const marca = MARCAS[i % MARCAS.length]!;
    const price = (250 + i * 35).toFixed(2);
    return {
      businessId,
      sku: `LL-${String(i + 1).padStart(4, '0')}`,
      barcode: `77${String(1000000 + i)}`,
      name: `Llanta ${marca} ${medida}`,
      categoryId: cat!.id,
      // Primeros 12 productos son de la central; el resto de la sucursal.
      locationId: i < 12 ? centralId : puebloId,
      price,
      cost: (Number(price) * 0.7).toFixed(2), // compra unitario
      costWholesale: (Number(price) * 0.6).toFixed(2), // compra por mayor (mas barato)
      attributes: { medida, marca },
    };
  });
  const products = await db.insert(s.product).values(productValues).returning();

  // Stock inicial en ambas ubicaciones.
  await db.insert(s.inventory).values(
    products.flatMap((p) =>
      locations.map((loc) => ({
        businessId,
        productId: p.id,
        locationId: loc.id,
        quantity: 12,
        minStock: 4,
      })),
    ),
  );

  console.log('✓ Seed completo:');
  console.log('  Negocio: Llantas El Rapido');
  console.log('  Login admin    -> usuario: admin    / clave: admin123');
  console.log('  Login vendedor -> usuario: vendedor / clave: vende123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => queryClient.end());
