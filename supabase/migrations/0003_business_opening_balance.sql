-- Phase 4: what the business owed before the first import, so "Still owed" can be worked out.
alter table settings add column if not exists business_owed_before numeric(12,2);
alter table settings add column if not exists business_owed_as_of date; -- the day that figure applies to
