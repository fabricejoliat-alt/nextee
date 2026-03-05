-- Safety helpers for OM compute engine.
-- Recreate helper functions if they are missing so downstream migrations compile.

create or replace function public.om_competition_coefficient(p_level text)
returns numeric
language sql
immutable
as $$
  select case p_level
    when 'club_internal' then 0.8
    when 'club_official' then 1.0
    when 'regional' then 1.2
    when 'national' then 1.4
    when 'international' then 1.6
    else 1.0
  end::numeric;
$$;

create or replace function public.om_holes_bonus_net(p_rounds_18_count smallint)
returns numeric
language sql
immutable
as $$
  select case p_rounds_18_count
    when 2 then 5
    when 3 then 10
    when 4 then 15
    else 0
  end::numeric;
$$;

create or replace function public.om_holes_bonus_brut(p_rounds_18_count smallint)
returns numeric
language sql
immutable
as $$
  select case p_rounds_18_count
    when 2 then 10
    when 3 then 20
    when 4 then 30
    else 0
  end::numeric;
$$;

