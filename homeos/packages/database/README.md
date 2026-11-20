# @homeos/database

Rijtypen en zod-invoerschema's voor de Supabase-tabellen, plus de RLS-testsuite (`test/rls.test.ts`). Die draait
de echte migraties op PGlite (Postgres in WebAssembly) met een minimale Supabase-auth-nabootsing (`test/supabase-shim.sql`).

Migraties staan in `supabase/migrations/`. Zie `docs/supabase.md`.
