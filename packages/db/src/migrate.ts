import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db, queryClient } from './client.js';

await migrate(db, { migrationsFolder: './migrations' });
console.log('✓ Migraciones aplicadas');
await queryClient.end();
