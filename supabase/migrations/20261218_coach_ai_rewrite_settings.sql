begin;
create table if not exists public.coach_ai_rewrite_settings (
 singleton boolean primary key default true check(singleton),
 instructions text not null check(length(btrim(instructions)) between 20 and 6000),
 revision integer not null default 1 check(revision>0),
 updated_at timestamptz not null default now(),
 updated_by uuid references auth.users(id)
);
insert into public.coach_ai_rewrite_settings(singleton,instructions) values(true,$guidance$Reformule sans résumer ni supprimer de contenu utile.
Conserve chaque observation technique et sa correction : position du club ou du corps, moment précis du mouvement, direction, côté et point de vigilance.
Conserve tous les exercices, leur matériel, leur objectif, les distances, les quantités et les répétitions.
Corrige l’orthographe et les formulations maladroites. Organise le texte pour le rendre clair et respectueux, sans inventer de faits.
Si un passage est ambigu, conserve son information sans interprétation technique nouvelle.
Exemple : « Club légèrement intérieur au milieu du backswing : armer les poignets plus tôt pour laisser le club dans le plan. » doit conserver à la fois le constat « légèrement intérieur », le moment « au milieu du backswing » et la correction des poignets.$guidance$) on conflict(singleton) do nothing;
alter table public.coach_ai_rewrite_settings enable row level security;
revoke all on public.coach_ai_rewrite_settings from public,anon,authenticated;
grant select,update on public.coach_ai_rewrite_settings to service_role;
notify pgrst,'reload schema';
commit;
