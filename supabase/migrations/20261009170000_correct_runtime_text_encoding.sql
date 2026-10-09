-- Repair visible mojibake left by historical UTF-8/Windows-1252 migration
-- transport. Replace only fixed literal sequences in known function bodies.
-- Code points keep this migration itself ASCII-only and portable.
do $migration$
declare
  v_proc regprocedure;
  v_definition text;
  v_bad_dash text := pg_catalog.chr(226) || pg_catalog.chr(8364) || pg_catalog.chr(8221);
  v_good_dash text := pg_catalog.chr(8212);
  v_bad_bullet text := pg_catalog.chr(226) || pg_catalog.chr(8364) || pg_catalog.chr(162);
  v_good_bullet text := pg_catalog.chr(8226);
  v_bad_ellipsis text := pg_catalog.chr(226) || pg_catalog.chr(8364) || pg_catalog.chr(166);
  v_good_ellipsis text := pg_catalog.chr(8230);
begin
  v_proc := pg_catalog.to_regprocedure(
    'al_private.al_sessions_copy_week(text,text,text[],integer,text,text,text,boolean,boolean,integer)');
  if v_proc is not null then
    v_definition := pg_catalog.pg_get_functiondef(v_proc);
    if pg_catalog.strpos(v_definition, v_bad_dash) > 0 then
      execute pg_catalog.replace(v_definition, v_bad_dash, v_good_dash);
    end if;
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'al_private.al_telegram_webhook_command(text,text,text,text,text,text,boolean)');
  if v_proc is not null then
    v_definition := pg_catalog.pg_get_functiondef(v_proc);
    if pg_catalog.strpos(v_definition, v_bad_bullet) > 0 then
      execute pg_catalog.replace(v_definition, v_bad_bullet, v_good_bullet);
    end if;
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'al_private.al_operator_link_billing_customer(text,text)');
  if v_proc is not null then
    v_definition := pg_catalog.pg_get_functiondef(v_proc);
    if pg_catalog.strpos(v_definition, v_bad_ellipsis) > 0 then
      execute pg_catalog.replace(v_definition, v_bad_ellipsis, v_good_ellipsis);
    end if;
  end if;

  v_proc := pg_catalog.to_regprocedure(
    'al_private.al_operator_access_inspect(text,integer)');
  if v_proc is not null then
    v_definition := pg_catalog.pg_get_functiondef(v_proc);
    if pg_catalog.strpos(v_definition, v_bad_ellipsis) > 0 then
      execute pg_catalog.replace(v_definition, v_bad_ellipsis, v_good_ellipsis);
    end if;
  end if;
end;
$migration$;
