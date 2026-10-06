-- Make the existing FTEM defaults available as soon as a club is created.
-- Existing clubs and their editable targets are left untouched.
create table if not exists public.training_volume_default_targets (
  ftem_code text primary key,
  level_label text not null,
  handicap_label text not null,
  handicap_min numeric(6,2),
  handicap_max numeric(6,2),
  motivation_text text,
  minutes_offseason integer not null check (minutes_offseason >= 0),
  minutes_inseason integer not null check (minutes_inseason >= 0),
  sort_order integer not null unique
);

insert into public.training_volume_default_targets (
  ftem_code, level_label, handicap_label, handicap_min, handicap_max,
  motivation_text, minutes_offseason, minutes_inseason, sort_order
) values
  ('F1','Junior Explorer I','54.0',54,54,'Tu découvres le golf et développes les bases du jeu. Un volume d’entraînement d’une heure par semaine t’aide à construire les fondations de ton futur niveau.',180,180,10),
  ('F2','Junior Explorer II','36.1-53.9',36.1,53.9,'Tu apprends à jouer sur le parcours et à devenir autonome. Un volume d’une à 2 heures d’entraînement par semaine permet de progresser régulièrement.',240,240,20),
  ('F3','Junior Explorer III','18.1-36.0',18.1,36.0,'Tu développes ton jeu et gagnes en régularité. Un volume de 4 à 6 heures par semaine t’aide à franchir les prochaines étapes.',360,360,30),
  ('T1','Junior Competitor','10.1-18.0',10.1,18.0,'Aujourd’hui tu es un joueur compétitif. Tu développes un niveau avancé et te rapproches du single handicap. Pour progresser et performer en tournoi, un volume d’entraînement de 8 à 10 heures par semaine est recommandé.',720,600,40),
  ('T2','Junior Challenger','5.1-10.0',5.1,10.0,'Un volume de 12 à 15 heures par semaine permet de faire la différence en compétition.',960,840,50),
  ('T3','Junior Performer','0.0-5.0',0,5.0,'Tu fais partie des joueurs de performance. Ton entraînement vise maintenant l’excellence avec 18 à 22 heures d’entraînement par semaine.',1440,1320,60),
  ('T4','Junior Elite','+0.1 a +2.0',-2.0,-0.1,'Tu évolues parmi les meilleurs juniors. Pour viser les tournois nationaux et internationaux, l’entraînement atteint 22 à 25 heures par semaine.',1920,1800,70),
  ('E1','International Elite','+2.1 a +4.0',-4.0,-2.1,'Tu évolues au niveau élite amateur. Ton entraînement se situe généralement autour de 25 à 30 heures par semaine.',2400,2280,80),
  ('E2','World Elite','+4.1 a +6.0',-6.0,-4.1,'Tu fais partie de l’élite internationale. Ton entraînement est celui d’un athlète de haut niveau avec environ 30 heures par semaine ou plus.',3000,2760,90),
  ('M','Champion','Tour level',null,null,'Tu vises l’excellence au plus haut niveau du golf mondial. L’entraînement dépasse généralement 30 heures par semaine et chaque détail compte.',3600,3300,100)
on conflict (ftem_code) do update set
  level_label=excluded.level_label,
  handicap_label=excluded.handicap_label,
  handicap_min=excluded.handicap_min,
  handicap_max=excluded.handicap_max,
  motivation_text=excluded.motivation_text,
  minutes_offseason=excluded.minutes_offseason,
  minutes_inseason=excluded.minutes_inseason,
  sort_order=excluded.sort_order;

alter table public.training_volume_default_targets enable row level security;
revoke all on public.training_volume_default_targets from public, anon, authenticated;
grant select on public.training_volume_default_targets to service_role;

create or replace function public.seed_new_club_training_volume()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.training_volume_settings (organization_id)
  values (new.id) on conflict (organization_id) do nothing;

  insert into public.training_volume_targets (
    organization_id, ftem_code, level_label, handicap_label, handicap_min,
    handicap_max, motivation_text, minutes_offseason, minutes_inseason, sort_order
  )
  select new.id, ftem_code, level_label, handicap_label, handicap_min,
    handicap_max, motivation_text, minutes_offseason, minutes_inseason, sort_order
  from public.training_volume_default_targets
  on conflict (organization_id, ftem_code) do nothing;
  return new;
end $$;
revoke all on function public.seed_new_club_training_volume() from public, anon, authenticated;

drop trigger if exists seed_new_club_training_volume on public.clubs;
create trigger seed_new_club_training_volume
after insert on public.clubs
for each row execute function public.seed_new_club_training_volume();
