-- Add motivational paragraph per FTEM level for training volume module.

alter table if exists public.training_volume_targets
  add column if not exists motivation_text text null;
