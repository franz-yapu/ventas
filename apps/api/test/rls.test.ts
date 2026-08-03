import { db, disableRlsStatements, enableRlsStatements, schema, withTenant } from '@ventafacil/db';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTenant, makeApp, resetDb, type Tenant } from './helpers.js';
import { closeOwner, runAsOwner } from './owner-db.js';

/**
 * Prueba de que RLS hace el trabajo por sí solo.
 *
 * Todas las consultas de esta suite se escriben A PROPÓSITO sin `where business_id`,
 * simulando el descuido que hoy sería una fuga. Si Postgres devuelve sólo las filas
 * del negocio en contexto, el aislamiento ya no depende de la memoria de nadie.
 */

let app: FastifyInstance;
let a: Tenant;
let b: Tenant;

beforeAll(async () => {
  app = await makeApp();
  await resetDb();
  // Los tenants se crean ANTES de activar RLS: darlos de alta es una operación de
  // plataforma, sin tenant en contexto.
  a = await createTenant(app, 'rls-a');
  b = await createTenant(app, 'rls-b');
  await runAsOwner(enableRlsStatements);
});

afterAll(async () => {
  // Imprescindible: si RLS quedara activo, rompería las demás suites.
  await runAsOwner(disableRlsStatements);
  await closeOwner();
  await app?.close();
});

describe('lectura sin filtro de tenant', () => {
  it('una consulta SIN where devuelve sólo los productos del negocio en contexto', async () => {
    const deA = await withTenant(a.businessId, (tx) => tx.select().from(schema.product));
    expect(deA).toHaveLength(1);
    expect(deA[0]!.id).toBe(a.productId);

    const deB = await withTenant(b.businessId, (tx) => tx.select().from(schema.product));
    expect(deB).toHaveLength(1);
    expect(deB[0]!.id).toBe(b.productId);
  });

  it('lo mismo para clientes, ventas y auditoría', async () => {
    await withTenant(a.businessId, async (tx) => {
      expect(await tx.select().from(schema.customer)).toHaveLength(1);
      expect(await tx.select().from(schema.sale)).toHaveLength(1);
      expect((await tx.select().from(schema.appUser)).every((u) => u.businessId === a.businessId)).toBe(true);
    });
  });

  it('sale_item hereda el aislamiento de su venta', async () => {
    const items = await withTenant(a.businessId, (tx) => tx.select().from(schema.saleItem));
    expect(items).toHaveLength(1);
    expect(items[0]!.saleId).toBe(a.saleId);
  });

  it('pedir explícitamente el id ajeno tampoco lo devuelve', async () => {
    const robo = await withTenant(a.businessId, (tx) =>
      tx.select().from(schema.product).where(eq(schema.product.id, b.productId)),
    );
    expect(robo).toHaveLength(0);
  });
});

describe('falla cerrado', () => {
  it('sin tenant en contexto no se ve NADA (no se ve todo)', async () => {
    // La propiedad importante: un olvido produce "no hay datos", nunca "están todos".
    const filas = await db.select().from(schema.product);
    expect(filas).toHaveLength(0);
  });
});

describe('escritura', () => {
  it('no se puede insertar una fila a nombre de otro negocio', async () => {
    await expect(
      withTenant(a.businessId, (tx) =>
        tx.insert(schema.product).values({
          businessId: b.businessId, // ← intento de suplantación
          locationId: b.locationId,
          sku: 'INTRUSO',
          name: 'Producto intruso',
          price: '1.00',
          cost: '1.00',
        }),
      ),
    ).rejects.toThrow();
  });

  it('un UPDATE sin where no toca las filas de otro negocio', async () => {
    await withTenant(a.businessId, (tx) => tx.update(schema.product).set({ name: 'RENOMBRADO' }));

    const deB = await withTenant(b.businessId, (tx) => tx.select().from(schema.product));
    expect(deB[0]!.name).toBe(`Producto secreto de ${b.slug}`);

    const deA = await withTenant(a.businessId, (tx) => tx.select().from(schema.product));
    expect(deA[0]!.name).toBe('RENOMBRADO');
  });

  it('un DELETE sin where no borra las filas de otro negocio', async () => {
    await withTenant(a.businessId, (tx) => tx.delete(schema.customer));

    expect(await withTenant(a.businessId, (tx) => tx.select().from(schema.customer))).toHaveLength(0);
    expect(await withTenant(b.businessId, (tx) => tx.select().from(schema.customer))).toHaveLength(1);
  });
});

describe('el contexto no se filtra entre transacciones', () => {
  it('tras una transacción de A, la conexión no arrastra su tenant', async () => {
    await withTenant(a.businessId, (tx) => tx.select().from(schema.product));
    // Misma conexión del pool, ya sin contexto: debe volver a fallar cerrado.
    expect(await db.select().from(schema.product)).toHaveLength(0);
  });

  it('transacciones concurrentes de negocios distintos no se mezclan', async () => {
    const [deA, deB] = await Promise.all([
      withTenant(a.businessId, (tx) => tx.select().from(schema.sale)),
      withTenant(b.businessId, (tx) => tx.select().from(schema.sale)),
    ]);
    expect(deA.every((s) => s.businessId === a.businessId)).toBe(true);
    expect(deB.every((s) => s.businessId === b.businessId)).toBe(true);
  });
});
