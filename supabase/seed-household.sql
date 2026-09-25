-- Creates the household and adds every Auth user as a member. Run once AFTER both users exist
-- under Auth → Users (SQL editor, or the Management API). Safe to run again. No emails needed:
-- public sign-up is off, so the only users are the two of you.
begin;
insert into households (name)
select 'Goud household' where not exists (select 1 from households);

insert into household_members (household_id, user_id)
select h.id, u.id from households h cross join auth.users u
on conflict do nothing;
commit;

-- Then set the names shown in the app, e.g.:
-- update household_members m set display_name = 'Loz'
--   from auth.users u where u.id = m.user_id and u.email = '<your email>';
