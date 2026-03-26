do $$
declare
  sion_club_ids uuid[];
begin
  select coalesce(array_agg(c.id), '{}')
  into sion_club_ids
  from public.clubs c
  where lower(trim(coalesce(c.name, ''))) = 'golf club sion'
     or lower(trim(coalesce(c.slug, ''))) in ('golf-club-sion', 'golf-club-de-sion', 'golf-club-sion-sa', 'sion');

  if coalesce(array_length(sion_club_ids, 1), 0) = 0 then
    raise notice 'No Golf Club Sion club found. Sion-specific player fields unchanged.';
    return;
  end if;

  update public.club_player_fields
  set is_active = true,
      updated_at = now()
  where club_id = any(sion_club_ids)
    and (
      legacy_binding in (
        'player_course_track',
        'player_membership_paid',
        'player_playing_right_paid'
      )
      or regexp_replace(lower(trim(coalesce(label, ''))), '\s+', ' ', 'g') in (
        'cours',
        'cotisation',
        'droit de jeu'
      )
      or lower(trim(coalesce(field_key, ''))) in (
        'legacy_course_track',
        'legacy_membership_paid',
        'legacy_playing_right_paid'
      )
      or lower(trim(coalesce(field_key, ''))) like 'cours\_%' escape '\'
      or lower(trim(coalesce(field_key, ''))) like 'cotisation\_%' escape '\'
      or lower(trim(coalesce(field_key, ''))) like 'droit_de_jeu\_%' escape '\'
    );

  update public.club_player_fields
  set is_active = false,
      updated_at = now()
  where club_id <> all(sion_club_ids)
    and (
      legacy_binding in (
        'player_course_track',
        'player_membership_paid',
        'player_playing_right_paid'
      )
      or regexp_replace(lower(trim(coalesce(label, ''))), '\s+', ' ', 'g') in (
        'cours',
        'cotisation',
        'droit de jeu'
      )
      or lower(trim(coalesce(field_key, ''))) in (
        'legacy_course_track',
        'legacy_membership_paid',
        'legacy_playing_right_paid'
      )
      or lower(trim(coalesce(field_key, ''))) like 'cours\_%' escape '\'
      or lower(trim(coalesce(field_key, ''))) like 'cotisation\_%' escape '\'
      or lower(trim(coalesce(field_key, ''))) like 'droit_de_jeu\_%' escape '\'
    );
end $$;
