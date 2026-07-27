import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // Both files: drizzle-kit only emits CREATE TYPE for enums it can see declared, and
  // importing them into tables.ts is not enough.
  schema: ['./src/enums.ts', './src/tables.ts'],
  out: './migrations',
  casing: 'snake_case',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgres://gridiron:gridiron@127.0.0.1:5433/gridiron',
  },
  strict: true,
  verbose: true,
});
