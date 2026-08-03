import { db, schema } from '@ventafacil/db';
import argon2 from 'argon2';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';

export interface Tenant {
  businessId: string;
  slug: string;
  locationId: string;
  adminId: string;
  adminToken: string;
  /** Datos propios, para comprobar que el OTRO tenant no los alcanza. */
  productId: string;
  customerId: string;
  categoryId: string;
  saleId: string;
}

export async function makeApp(): Promise<FastifyInstance> {
  const app = await buildApp({ logger: false });
  await app.ready();
  return app;
}

export function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

/** Vacía las tablas de negocio entre suites (cascade desde business). */
export async function resetDb() {
  await db.delete(schema.business);
}

/**
 * Crea un negocio completo con datos propios y devuelve su token de admin.
 * Se inserta directo en la BD (no por API) para no depender de endpoints que
 * son justamente lo que estamos poniendo a prueba.
 */
export async function createTenant(app: FastifyInstance, slug: string): Promise<Tenant> {
  const [biz] = await db
    .insert(schema.business)
    .values({ name: `Negocio ${slug}`, slug })
    .returning();
  const businessId = biz!.id;

  // Arranca en 1 porque más abajo se siembra una venta con el recibo #1. Si se dejara
  // en 0, la primera venta que cree el API reusaría ese número y chocaría con la
  // restricción única (sale_business_receipt_uq).
  await db.insert(schema.businessCounter).values({ businessId, lastReceiptNumber: 1 });

  const [loc] = await db
    .insert(schema.location)
    .values({ businessId, name: `Central ${slug}`, isCentral: true })
    .returning();
  const locationId = loc!.id;

  const passwordHash = await argon2.hash('secreto123');
  const [admin] = await db
    .insert(schema.appUser)
    .values({
      businessId,
      locationId,
      name: `Admin ${slug}`,
      username: 'admin',
      passwordHash,
      role: 'admin',
    })
    .returning();

  const [cat] = await db
    .insert(schema.category)
    .values({ businessId, name: `Categoria ${slug}` })
    .returning();

  const [prod] = await db
    .insert(schema.product)
    .values({
      businessId,
      locationId,
      sku: `SKU-${slug}`,
      name: `Producto secreto de ${slug}`,
      price: '100.00',
      cost: '50.00',
      categoryId: cat!.id,
    })
    .returning();

  await db
    .insert(schema.inventory)
    .values({ businessId, productId: prod!.id, locationId, quantity: 10, minStock: 1 });

  const [cust] = await db
    .insert(schema.customer)
    .values({ businessId, name: `Cliente secreto de ${slug}` })
    .returning();

  // Una venta con su línea, para probar lectura cruzada de ventas y reportes.
  const saleId = crypto.randomUUID();
  await db.insert(schema.sale).values({
    id: saleId,
    businessId,
    locationId,
    userId: admin!.id,
    customerId: cust!.id,
    subtotal: '100.00',
    total: '100.00',
    paymentMethod: 'cash',
    receiptNumber: 1,
    clientCreatedAt: new Date(),
  });
  await db.insert(schema.saleItem).values({
    saleId,
    productId: prod!.id,
    productNameSnapshot: prod!.name,
    unitPriceSnapshot: '100.00',
    unitCostSnapshot: '50.00',
    quantity: 1,
    lineTotal: '100.00',
  });

  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { username: 'admin', password: 'secreto123', business: slug },
  });
  const body = res.json();
  if (!body.data?.accessToken) {
    throw new Error(`Login fallido para ${slug}: ${res.body}`);
  }

  return {
    businessId,
    slug,
    locationId,
    adminId: admin!.id,
    adminToken: body.data.accessToken,
    productId: prod!.id,
    customerId: cust!.id,
    categoryId: cat!.id,
    saleId,
  };
}
