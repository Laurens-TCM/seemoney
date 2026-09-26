-- v2 Phase 9: trips become events with a type. Reviewed against the live schema. Safe to re-run.
do $$ begin
  if to_regclass('public.events') is null and to_regclass('public.trips') is not null
     and (select relkind from pg_class where oid = 'public.trips'::regclass) = 'r' then
    alter table trips rename to events;
  end if;
  if to_regclass('public.event_overrides') is null and to_regclass('public.trip_overrides') is not null
     and (select relkind from pg_class where oid = 'public.trip_overrides'::regclass) = 'r' then
    alter table trip_overrides rename to event_overrides;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'event_overrides' and column_name = 'trip_id') then
    alter table event_overrides rename column trip_id to event_id;
  end if;
end $$;

alter table events add column if not exists type text not null default 'trip';
do $$ begin
  alter table events add constraint events_type_check check (type in ('trip','big','loan','income','bill'));
exception when duplicate_object then null; end $$;
-- Trip-only fields: no trip defaults for other events, but trips still need them.
alter table events alter column place drop not null, alter column place drop default;
alter table events alter column kind drop not null, alter column kind drop default;
do $$ begin
  alter table events add constraint events_trip_fields check (type <> 'trip' or (kind is not null and place is not null));
exception when duplicate_object then null; end $$;

-- Compatibility for the app still deployed on phones until it updates. security_invoker makes
-- the views obey row-level security (a plain view runs as its owner and would bypass it).
create or replace view trips with (security_invoker = true) as
  select id, household_id, name, start_date, end_date, kind, place, recharge_to_business, created_by, created_at
  from events where type = 'trip';
create or replace view trip_overrides with (security_invoker = true) as
  select event_id as trip_id, household_id, tx_id, included from event_overrides;

create table if not exists dismissed_events (   -- "Label this?" suggestions dismissed, by transaction
  household_id uuid not null references households on delete cascade,
  tx_id text not null,
  primary key (household_id, tx_id)
);
alter table dismissed_events enable row level security;
drop policy if exists member_all on dismissed_events;
create policy member_all on dismissed_events for all using (is_member(household_id)) with check (is_member(household_id));

alter table settings add column if not exists big_purchase_threshold numeric(12,2) default 1000;

do $$ declare t text; begin
  foreach t in array array['dismissed_events'] loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
-- events and event_overrides stay in the publication through the rename.
-- Later cleanup, once no deployed app reads them: drop view trips; drop view trip_overrides;
