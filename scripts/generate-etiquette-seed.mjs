import { writeFileSync } from "node:fs";
import { etiquetteCards, etiquetteThemes } from "../data/etiquette.fr.mjs";

if (etiquetteThemes.length !== 12 || etiquetteCards.length !== 36) throw new Error("Expected 12 themes and 36 cards");
for (let theme = 1; theme <= 12; theme++) {
  const prefix = String(theme).padStart(2, "0");
  const cards = etiquetteCards.filter((card) => card.key.startsWith(`${prefix}.`));
  if (cards.length !== 3 || cards.some((card, index) => card.key !== `${prefix}.${index + 1}`)) throw new Error(`Invalid theme ${prefix}`);
}

const rows = etiquetteThemes.map((title, index) => ({ position: index + 1, stable_key: String(index + 1).padStart(2, "0"), title }));
const sqlString = (value) => `'${value.replaceAll("'", "''")}'`;
const themeSql = rows.map((theme) => `insert into public.etiquette_themes(stable_key,position,title_i18n)
values (${sqlString(theme.stable_key)},${theme.position},jsonb_build_object('fr',${sqlString(theme.title)}))
on conflict (stable_key) do nothing;`).join("\n");
const cardSql = etiquetteCards.map((card) => {
  const [theme, position] = card.key.split(".");
  const fields = ["title", "situation", "simple_explanation", "action_text", "common_mistake", "mission_text", "coach_tip", "official_reference", "reference_version", "reference_kind"];
  return `insert into public.etiquette_cards(theme_id,stable_key,position)
select id,${sqlString(card.key)},${Number(position)} from public.etiquette_themes where stable_key=${sqlString(theme)}
on conflict (stable_key) do nothing;
insert into public.etiquette_card_versions(card_id,version,locale,${fields.join(",")})
select id,1,'fr',${fields.map((field) => sqlString(card[field])).join(",")}
from public.etiquette_cards where stable_key=${sqlString(card.key)}
on conflict (card_id,version,locale) do nothing;`;
}).join("\n");
writeFileSync(new URL("../supabase/migrations/20261019_seed_etiquette_fr.sql", import.meta.url),
  `-- Additive and rerunnable seed. Existing edits and approvals are preserved.\n${themeSql}\n${cardSql}\n`);
