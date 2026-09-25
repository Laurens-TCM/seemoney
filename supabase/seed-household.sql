-- Run once in the Supabase SQL editor AFTER both users exist under Auth → Users.
-- Replace the two emails and the second display name.
with h as (insert into households (name) values ('Goud household') returning id)
insert into household_members (household_id, user_id, display_name)
select h.id, u.id, case when u.email = 'loz@example.com' then 'Loz' else 'Partner' end
from h, auth.users u
where u.email in ('loz@example.com', 'partner@example.com');
