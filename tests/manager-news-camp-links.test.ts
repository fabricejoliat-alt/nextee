import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const managerNews = readFileSync(
  new URL("../components/manager/ManagerNewsWorkspace.tsx", import.meta.url),
  "utf8",
);
const playerNews = readFileSync(
  new URL("../components/player/PlayerNewsFeed.tsx", import.meta.url),
  "utf8",
);
const clubNews = readFileSync(
  new URL("../components/news/ClubNewsFeed.tsx", import.meta.url),
  "utf8",
);
const notifications = readFileSync(
  new URL("../components/notifications/NotificationsCenter.tsx", import.meta.url),
  "utf8",
);
const playerCamps = readFileSync(
  new URL("../app/player/camps/page.tsx", import.meta.url),
  "utf8",
);

test("manager news lists each camp once instead of listing its day events", () => {
  assert.match(managerNews, /setLinkedCamps\(Array\.isArray\(json\.target_options\?\.camps\)/);
  assert.match(managerNews, /linkedEvents\.filter\(\(event\) => event\.event_type !== "camp"\)/);
  assert.match(managerNews, /<option key=\{camp\.id\} value=\{`camp:\$\{camp\.id\}`\}>\{camp\.title\}<\/option>/);
});

test("selecting a camp persists the camp link rather than a day event link", () => {
  assert.match(managerNews, /const campId = kind === "camp" \? id : ""/);
  assert.match(managerNews, /linked_club_event_id: eventId,\s+linked_camp_id: campId/);
});

test("player-facing camp links target the matching registration card", () => {
  for (const source of [playerNews, clubNews, notifications]) {
    assert.match(source, /new URLSearchParams\(\{ camp_id:/);
    assert.match(source, /`\/player\/camps\?\$\{params\.toString\(\)\}`/);
  }

  assert.match(playerCamps, /searchParams\.get\("camp_id"\)/);
  assert.match(playerCamps, /document\.getElementById\(`camp-\$\{linkedCampId\}`\)\?\.scrollIntoView/);
  assert.match(playerCamps, /id=\{`camp-\$\{camp\.id\}`\}/);
});
