-- See The Money: initial schema. Apply with `npx supabase db push`.
-- Written to be safe to re-run.

create table if not exists households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists household_members (
  household_id uuid references households on delete cascade,
  user_id uuid references auth.users on delete cascade,
  display_name text,
  primary key (household_id, user_id)
);

create or replace function is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from household_members where household_id = h and user_id = auth.uid());
$$;

create table if not exists imports (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  uploaded_by uuid references auth.users,
  source_filename text,
  from_date date not null, to_date date not null,
  line_count int, skipped_count int,
  created_at timestamptz default now(),
  unique (id, household_id)
);

do $$ begin
  create type line_kind as enum ('income','other_in','spend','internal','loan_in',
    'business_loan','business_loan_repaid','capital','excluded');
exception when duplicate_object then null; end $$;

create table if not exists lines (
  household_id uuid not null references households on delete cascade,
  tx_id text not null,                 -- Frollo transaction_id (rows without one are never stored)
  import_id uuid,
  date date not null,
  name text not null,
  amount numeric(12,2) not null,       -- signed as in Frollo (out is negative)
  kind line_kind not null,             -- as classified; line_overrides may change it
  income_source text,
  category text,
  grp text,
  bucket text,
  loc text check (loc in ('vic','fx') or loc is null),
  account text,
  label text,
  needs_review boolean default false,  -- e.g. "Check: pay or loan repayment?"
  primary key (household_id, tx_id),
  foreign key (import_id, household_id) references imports (id, household_id) on delete set null (import_id)
);
create index if not exists lines_household_date on lines (household_id, date);

create table if not exists line_overrides (
  household_id uuid not null references households on delete cascade,
  tx_id text not null,
  kind line_kind,
  category text,
  note text,
  updated_by uuid references auth.users,
  updated_at timestamptz default now(),
  primary key (household_id, tx_id)
);

create table if not exists trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  start_date date not null, end_date date not null check (end_date >= start_date),
  kind text not null default 'family' check (kind in ('family','holiday','work')),
  place text not null default 'melbourne' check (place in ('melbourne','overseas','any')),
  recharge_to_business boolean default false,
  created_by uuid references auth.users,
  created_at timestamptz default now(),
  unique (id, household_id)
);

create table if not exists trip_overrides (
  trip_id uuid not null,
  household_id uuid not null,
  tx_id text not null,
  included boolean not null,
  primary key (trip_id, tx_id),
  foreign key (trip_id, household_id) references trips (id, household_id) on delete cascade
);

create table if not exists dismissed_suggestions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  from_date date not null, to_date date not null   -- clusters overlapping this range stay hidden
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null default '',
  amount numeric(12,2),
  target_month date,                   -- first day of month
  saved numeric(12,2) default 0,
  sort int default 0
);

create table if not exists targets (
  household_id uuid references households on delete cascade,
  grp text,
  monthly_target numeric(12,2),        -- null = use the average
  trimmable boolean,                   -- null = use trimDefaults from config
  primary key (household_id, grp)
);

create table if not exists settings (   -- shared by the household
  household_id uuid primary key references households on delete cascade,
  offset_balance numeric(12,2),
  offset_as_of date
);

create table if not exists user_settings (  -- each person's own view choices
  household_id uuid references households on delete cascade,
  user_id uuid references auth.users on delete cascade,
  hide_trips boolean,                  -- null = on whenever a trip exists
  window_months int default 12 check (window_months in (3,6,12)),
  primary key (household_id, user_id)
);

-- Row-level security: household members only.
do $$ declare t text; begin
  foreach t in array array['imports','lines','line_overrides','trips','trip_overrides',
                           'dismissed_suggestions','goals','targets','settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists member_all on %I', t);
    execute format('create policy member_all on %I for all using (is_member(household_id)) with check (is_member(household_id))', t);
  end loop;
end $$;

alter table user_settings enable row level security;
drop policy if exists own_row on user_settings;
create policy own_row on user_settings for all
  using (user_id = auth.uid() and is_member(household_id))
  with check (user_id = auth.uid() and is_member(household_id));

alter table households enable row level security;
drop policy if exists member_read on households;
create policy member_read on households for select using (is_member(id));
alter table household_members enable row level security;
drop policy if exists member_read on household_members;
create policy member_read on household_members for select using (is_member(household_id));

-- Realtime for shared editing
do $$ declare t text; begin
  foreach t in array array['trips','trip_overrides','line_overrides','goals','targets','settings','imports'] loop
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;
