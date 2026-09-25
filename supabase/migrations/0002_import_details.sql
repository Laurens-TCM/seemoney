-- Phase 3: keep why a line needs checking, and why rows were skipped on each import.
alter table lines add column if not exists review text;          -- e.g. "Check category: …"
alter table imports add column if not exists skipped_reasons jsonb; -- e.g. {"pending": 9}
alter table imports alter column uploaded_by set default auth.uid();
