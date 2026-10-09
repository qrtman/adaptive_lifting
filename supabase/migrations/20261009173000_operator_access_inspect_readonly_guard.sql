-- Keep operator access inspection read-only for incomplete workspaces. The
-- application access resolver can initialize a missing coach workspace, so
-- call it here only after inspection has confirmed an existing OWNER member.
do $migration$
declare
  v_proc regprocedure := pg_catalog.to_regprocedure(
    'al_private.al_operator_access_inspect(text,integer)');
  v_definition text;
  v_old text := E'if v_session_id is not null then\n      v_access := al_private.al_account_access_state(';
  v_new text := E'if v_session_id is not null and v_member.role = ''OWNER'' then\n      v_access := al_private.al_account_access_state(';
begin
  if v_proc is null then
    raise exception 'operator access inspector is missing';
  end if;
  v_definition := pg_catalog.pg_get_functiondef(v_proc);
  if pg_catalog.strpos(v_definition, v_old) > 0 then
    execute pg_catalog.replace(v_definition, v_old, v_new);
  end if;
end;
$migration$;
