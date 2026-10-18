-- The offline idempotency identity is the pair used by both sync services.
-- Existing rows have globally unique mutation IDs, so all satisfy the new key.
-- No foreign keys reference sync_mutations, so the primary key can safely move.
alter table public.sync_mutations
  drop constraint sync_mutations_pkey;

drop index if exists public.sync_mutations_device_mutation_idx;

alter table public.sync_mutations
  add constraint sync_mutations_pkey primary key (client_device_id, mutation_id);
