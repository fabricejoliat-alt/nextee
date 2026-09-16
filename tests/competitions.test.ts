import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyManualCompetitionSelection,
  competitionAgeInYear,
  competitionBoundaryIso,
  competitionRequiresCoach,
  competitionSupportsInternalAttendance,
  competitionTournamentYear,
  isReminderDispatchable,
  reminderChannelFlags,
  renderCompetitionReminderTemplate,
  selectCompetitionPlayerIds,
  type CompetitionCategory,
} from "../lib/competitions.ts";

test("l'âge repose uniquement sur l'année du tournoi, même avant l'anniversaire", () => {
  assert.equal(competitionAgeInYear("2012-12-31", 2026), 14);
  assert.equal(competitionAgeInYear("2011-12-31", 2026), 15);
  assert.deepEqual(
    selectCompetitionPlayerIds(
      [
        { id: "turns-14", birthDate: "2012-12-31" },
        { id: "turns-15", birthDate: "2011-12-31" },
      ],
      2026,
      "u14",
    ),
    ["turns-14"],
  );
});

test("chaque catégorie sélectionne les joueurs jusqu'à son âge maximum", () => {
  const players = [8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19].map((age) => ({
    id: `age-${age}`,
    birthDate: `${2026 - age}-06-15`,
  }));
  const expectations: Array<[CompetitionCategory, number]> = [
    ["u10", 2],
    ["u12", 4],
    ["u14", 6],
    ["u16", 8],
    ["u18", 10],
  ];

  expectations.forEach(([category, count]) => {
    assert.equal(selectCompetitionPlayerIds(players, 2026, category).length, count);
  });
});

test("Tous inclut tous les joueurs avec date de naissance et exclut les dates absentes", () => {
  const selected = selectCompetitionPlayerIds(
    [
      { id: "young", birthDate: "2018-01-01" },
      { id: "adult", birthDate: "1990-01-01" },
      { id: "missing", birthDate: null },
    ],
    2026,
    "all",
  );
  assert.deepEqual(selected, ["young", "adult"]);
});

test("une compétition sur deux années civiles est refusée", () => {
  assert.deepEqual(competitionTournamentYear("2026-12-30", "2027-01-02"), {
    year: null,
    error: "La compétition doit commencer et se terminer durant la même année civile.",
  });
  assert.deepEqual(competitionTournamentYear("2026-04-01", "2026-04-03"), { year: 2026, error: null });
  assert.equal(competitionTournamentYear("2026-02-31", "2026-03-02").year, null);
});

test("les bornes de journée suivent le fuseau suisse en hiver et en été", () => {
  assert.equal(competitionBoundaryIso("2026-01-15", "start"), "2026-01-14T23:00:00.000Z");
  assert.equal(competitionBoundaryIso("2026-01-15", "end"), "2026-01-15T22:59:59.999Z");
  assert.equal(competitionBoundaryIso("2026-07-15", "start"), "2026-07-14T22:00:00.000Z");
  assert.equal(competitionBoundaryIso("2026-07-15", "end"), "2026-07-15T21:59:59.999Z");
});

test("la sélection automatique reste modifiable manuellement", () => {
  assert.deepEqual(applyManualCompetitionSelection(["a", "b"], ["c"], ["b"]), ["a", "c"]);
});

test("les trois canaux de rappel sont interprétés correctement", () => {
  assert.deepEqual(reminderChannelFlags("in_app"), { inApp: true, email: false });
  assert.deepEqual(reminderChannelFlags("email"), { inApp: false, email: true });
  assert.deepEqual(reminderChannelFlags("both"), { inApp: true, email: true });
});

test("un rappel déjà traité ne peut pas être envoyé une seconde fois", () => {
  assert.equal(isReminderDispatchable("pending", null), true);
  assert.equal(isReminderDispatchable("processing", null), false);
  assert.equal(isReminderDispatchable("sent", "2026-04-01T08:00:00Z"), false);
});

test("les variables du rappel sont remplacées", () => {
  assert.equal(
    renderCompetitionReminderTemplate("{competition_name} {start_date} {end_date} {level} {category} {external_registration_url}", {
      competition_name: "Junior Open",
      start_date: "10.04.2026",
      end_date: "12.04.2026",
      level: "National",
      category: "U14",
      external_registration_url: "https://example.test/register",
    }),
    "Junior Open 10.04.2026 12.04.2026 National U14 https://example.test/register",
  );
});

test("une compétition n'active ni inscription ni présence interne et n'exige donc aucun coach", () => {
  assert.equal(competitionSupportsInternalAttendance("competition"), false);
  assert.equal(competitionRequiresCoach(), false);
  assert.equal(competitionSupportsInternalAttendance("training"), true);
});

test("les surfaces compétition ne proposent aucun contrôle d'inscription interne", () => {
  const sources = [
    "../app/manager/events/new/page.tsx",
    "../app/manager/calendar/page.tsx",
    "../app/player/page.tsx",
    "../app/player/golf/trainings/page.tsx",
  ].map((relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8")).join("\n");

  assert.doesNotMatch(sources, /Je m[’']inscris|Je participe/i);
  assert.match(sources, /plateforme externe/i);
});
