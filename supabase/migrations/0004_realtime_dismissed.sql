-- Phase 5: "Not a trip" on one phone hides the suggestion on the other too.
do $$ begin
  alter publication supabase_realtime add table dismissed_suggestions;
exception when duplicate_object then null; end $$;
