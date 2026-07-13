import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL no esta definida');

// Pool chico: el VPS KVM1 tiene 1 vCPU. No abrir mas conexiones de las utiles.
const poolMax = Number(process.env.DB_POOL_MAX ?? 8);

export const queryClient = postgres(url, { max: poolMax });
export const db = drizzle(queryClient, { schema, casing: 'snake_case' });

export type Database = typeof db;
