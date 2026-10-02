-- A real connection identity for the Edge Function. Keep all object privileges
-- in the NOLOGIN group role so the login inherits only the reviewed reader ACLs.
-- Provision its password separately through an interactive secure channel.
create role al_edge_catalog_runtime
  with login
       inherit
       nosuperuser
       nocreatedb
       nocreaterole
       noreplication
       nobypassrls;

-- INHERIT makes the reader's column grants usable without SET ROLE. Disable
-- SET and ADMIN so this login cannot change identity or delegate membership.
grant al_edge_catalog_reader to al_edge_catalog_runtime
  with inherit true, set false, admin false;
