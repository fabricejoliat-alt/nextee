-- One-time bootstrap for the dedicated Zurich project only.
-- Run in its SQL Editor after the owner creates exactly one confirmed Auth user.
-- This creates the corresponding profile and the sole platform-admin grant.
do $$
declare
  v_user auth.users%rowtype;
begin
  if (select count(*) from auth.users) <> 1
    or (select count(*) from public.clubs) <> 0
    or (select count(*) from public.profiles) <> 0
    or (select count(*) from public.app_admins) <> 0 then
    raise exception 'Zurich is not the expected single-user, club-free base';
  end if;

  select * into strict v_user from auth.users;
  if lower(v_user.email) <> 'info@activitee.golf'
    or v_user.email_confirmed_at is null then
    raise exception 'The expected confirmed superadmin user is missing';
  end if;

  insert into public.profiles (id) values (v_user.id);
  insert into public.app_admins (user_id) values (v_user.id);
end $$;

select
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.profiles) as profiles,
  (select count(*) from public.app_admins) as app_admins,
  (select count(*) from public.clubs) as clubs;
