do $$
begin
  alter type public.training_category add value if not exists 'short_game_all';
exception
  when undefined_object then
    null;
end
$$;
