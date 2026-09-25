-- v2 Phase 8: regular payments. The household's choice about each detected series, and regulars
-- added by hand. Safe to re-run.
create table if not exists regulars (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  series_key text,          -- merchant key + cadence, for display and a fallback match; null if hand-added
  tx_ids text[] not null default '{}', -- transactions in the series when the choice was made; matched by overlap
  status text not null default 'keep' check (status in ('keep','review','cancel','not_regular')),
  status_changed_at timestamptz default now(),
  -- hand-added regulars (detection can't see them yet, e.g. a new annual bill)
  name text, amount numeric(12,2),
  cadence text check (cadence in ('weekly','fortnightly','monthly','quarterly','yearly')),
  next_due date, grp text,
  note text,
  updated_by uuid references auth.users,
  unique (id, household_id)
);
create index if not exists regulars_household on regulars (household_id);

alter table regulars enable row level security;
drop policy if exists member_all on regulars;
create policy member_all on regulars for all using (is_member(household_id)) with check (is_member(household_id));

do $$ begin
  alter publication supabase_realtime add table regulars;
exception when duplicate_object then null; end $$;
