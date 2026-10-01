import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("platform news schema supports a club-role matrix and four locales", () => {
  const sql = read("supabase/migrations/20260930_add_activitee_news_module.sql");
  const roleSql = read("supabase/migrations/20261001_add_platform_news_role_matrix.sql");
  assert.match(sql, /create table if not exists public\.platform_news_clubs/);
  assert.match(sql, /locale in \('fr', 'en', 'de', 'it'\)/);
  assert.match(roleSql, /target_roles text\[\]/);
  assert.match(roleSql, /save_platform_news_v2/);
  assert.match(roleSql, /'player', 'coach', 'manager'/);
});

test("admin navigation and editor expose the platform news module", () => {
  assert.match(read("components/admin/AdminDesktopDrawer.tsx"), /Actualités ActiviTee/);
  const editor = read("components/admin/news/AdminNewsWorkspace.tsx");
  assert.match(editor, /Matrice des destinataires/);
  assert.match(editor, /Par type/);
  assert.match(editor, /toggleRoleForAll/);
  assert.match(editor, /Tous les/);
  assert.match(editor, /const LOCALES = \["fr", "en", "de", "it"\]/);
  assert.match(editor, /Traduire DE · EN · IT avec OpenAI/);
});

test("player and coach feeds request localized platform news", () => {
  const api = read("app/api/news/_lib.ts");
  assert.match(api, /fetchPublishedPlatformNewsForClubs/);
  assert.match(api, /localized\?\.get\(locale\) \?\? localized\?\.get\("fr"\)/);
  assert.match(read("components/player/PlayerNewsFeed.tsx"), /params\.set\("locale", locale\)/);
  assert.match(read("components/coach/CoachNewsFeed.tsx"), /api\/coach\/news\?locale=/);
  assert.match(read("app/api/manager/news/route.ts"), /"manager"/);
  assert.match(read("components/manager/ManagerNewsWorkspace.tsx"), /Actualités ActiviTee/);
});

test("OpenAI translation remains admin-only and returns three editable languages", () => {
  const route = read("app/api/admin/news/translate/route.ts");
  assert.match(route, /requirePlatformAdmin/);
  assert.match(route, /https:\/\/api\.openai\.com\/v1\/responses/);
  assert.match(route, /required: \["en", "de", "it"\]/);
  assert.match(route, /store: false/);
});
