-- Remove the one-time staging-only Vault provisioning helper after secret setup.
drop function if exists al_private.set_offline_auth_private_key_once(text,text);
