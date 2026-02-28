-- Parent contact is now managed via explicit parent<->child links.
-- Remove legacy parent fields from profiles.

alter table if exists public.profiles
  drop column if exists parent1_name,
  drop column if exists parent1_phone,
  drop column if exists parent1_email,
  drop column if exists parent2_name,
  drop column if exists parent2_phone,
  drop column if exists parent2_email;

