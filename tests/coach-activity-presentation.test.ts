import assert from "node:assert/strict";
import test from "node:test";
import { coachComponentHarness, elements, textContent, flush } from "./helpers/coachComponentHarness.ts";

const noFetch: typeof fetch = async () => { throw new Error("Unexpected network request"); };
const chartMocks = { "@/components/ui/ActiviteeEChart": { __esModule: true, default: "chart" } };

test("Coach player identity contains only the avatar, full name and localized handicap", (context) => {
  const props = { avatarUrl: "/avatar-test.png", name: "Milo Joliat", initials: "MJ", handicap: 14.2,
    groups: "Groupe à masquer", clubs: "Club à masquer", ftemLevel: "FTEM à masquer", nextActivity: "Activité à masquer" };
  const harness = coachComponentHarness("components/coach/player-detail/CoachPlayerIdentity.tsx", { fetch: noFetch, props });
  context.after(() => harness.cleanup());
  for (const locale of ["fr", "en", "de", "it"] as const) {
    harness.setLocale(locale);
    const tree = harness.render();
    const hcp = new Intl.NumberFormat(`${locale}-CH`, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(14.2);
    assert.equal(textContent(tree).trim(), `Milo Joliat Handicap ${hcp}`);
    const photo = elements(tree).find((node) => node.type === "img");
    assert.equal(photo?.props.src, "/avatar-test.png");
    assert.equal(photo?.props.alt, "Milo Joliat");
  }
  const zero = harness.render({ ...props, avatarUrl: "", handicap: 0 });
  assert.equal(elements(zero).filter((node) => node.type === "img").length, 0);
  assert.ok(textContent(zero).includes("MJ"));
  assert.ok(textContent(zero).includes(new Intl.NumberFormat("it-CH", { minimumFractionDigits: 1 }).format(0)));
  for (const handicap of [null, undefined, Number.NaN]) {
    const missing = harness.render({ ...props, handicap });
    assert.ok(textContent(missing).includes("Handicap —"));
    assert.ok(!textContent(missing).includes("NaN"));
  }
});

test("Coach home previews at most five pending activities and links the overflow to the annual list", async () => {
  for (const count of [5, 8]) {
    const events = Array.from({ length: count }, (_, index) => ({ id: String(index), starts_at: "2026-09-01T10:00:00Z" }));
    const harness = coachComponentHarness("app/coach/page.tsx", {
      fetch: async (url) => Response.json(String(url).includes("/home")
        ? { me: null, organizationNames: [], groupNameById: {}, clubNameByGroupId: {}, upcomingEvents: [], pendingEvalEvents: events }
        : { news: [] }),
      modules: { "./CoachLearningCards": { __esModule: true, default: "learning-cards" } },
    });
    harness.render(); await flush();
    const tree = harness.render();
    const preview = elements(tree).find((node) => node.props.pending === true);
    assert.equal(preview?.props.events.length, 5);
    const links = elements(tree).filter((node) => node.type === "a" && node.props.href === "/coach/calendar?view=evaluations&period=year");
    assert.equal(links.length, count > 5 ? 2 : 1); // Permanent shortcut, plus overflow when needed.
    harness.cleanup();
  }
});

test("Player validations use the shared sector tabs, preserve counts and switch sectors without writing", async () => {
  let reads = 0;
  const sections = ["Putting", "Petit jeu", "Scrambling", "Wedging"].map((name, index) => ({ id: String(index), name, exercises: [], total_count: 10, validated_count: index }));
  const harness = coachComponentHarness("app/player/validations/page.tsx", {
    fetch: async (_url, init) => { assert.equal(init?.method, undefined); reads++; return Response.json({ sections, overall_validated_count: 6, overall_total_count: 40, can_record_attempts: false }); },
    modules: {
      "@/components/player/PlayerBreadcrumb": { __esModule: true, default: "breadcrumb" },
      "next/image": { __esModule: true, default: "img" },
      "@/lib/effectivePlayer": { resolveEffectivePlayerContext: async () => ({ role: "player", effectiveUserId: "player" }) },
    },
  });
  harness.render(); await flush();
  const tabs = elements(harness.render()).find((node) => node.type === "tabs");
  assert.ok(tabs);
  assert.deepEqual(tabs.props.items.map((item: { label: string }) => item.label), ["Putting (0/10)", "Petit jeu (1/10)", "Scrambling (2/10)", "Wedging (3/10)"]);
  tabs.props.onChange("2");
  assert.equal(elements(harness.render()).find((node) => node.type === "tabs")?.props.value, "2");
  assert.equal(reads, 1);
  harness.cleanup();
});

test("activity cards keep type, group, conditional club and location, without losing either time", () => {
  const props = { startsAt: "2026-10-01T10:00:00Z", endsAt: "2026-10-01T11:30:00Z", typeLabel: "Entraînement", groupName: "Groupe A", clubName: "Club B", location: "Practice", showClub: false };
  const harness = coachComponentHarness("components/coach/CoachActivityCard.tsx", { fetch: noFetch, props,
    modules: { "./CoachActivityCard.module.css": { default: { card: "card", listItem: "list-item" } } },
  });
  const tree = harness.render();
  assert.equal(tree.props.className, "card", "other pages keep standalone cards by default");
  assert.ok(textContent(tree).includes("Groupe A"));
  assert.ok(textContent(tree).includes("Practice"));
  assert.ok(!textContent(tree).includes("Club B"));
  assert.deepEqual(elements(tree).filter((node) => node.type === "time").map((node) => node.props.dateTime), [props.startsAt, props.endsAt]);
  assert.match(textContent(harness.render({ ...props, showClub: true })), /Groupe A\s+· Club B/);
  const listItem = harness.render({ ...props, variant: "list" });
  assert.equal(listItem.props.className, "list-item", "dashboard rows do not retain the card frame");
  assert.equal(textContent(listItem), textContent(tree), "list presentation preserves activity information");
});

test("followup cards separate public/private notes and display both evaluations and custom answers", () => {
  const harness = coachComponentHarness("components/coach/player-detail/CoachPlayerFollowup.tsx", {
    fetch: noFetch, props: {
      events: [{ id: "event", starts_at: "2026-10-01T10:00:00Z", ends_at: null, event_type: "training", group_id: "group", group_name: "Groupe A", can_open_detail: false }],
      feedback: [{ event_id: "event", player_note: "Note partagée", private_note: "Note interne", engagement: 5, attitude: 4, application: 3 }],
      selfEvaluations: [{ club_event_id: "event", motivation: 6, difficulty: 2, satisfaction: 4, notes: "Retour du junior" }],
      notes: [{ id: "note", event_id: "event", body: "Note validée", author_name: "Coach A" }],
      criteria: [{ id: "criterion", event_id: "event", snapshot_name: "Ponctualité", snapshot_choices: [{ value: true, label: "À l’heure" }] }],
      responses: [{ event_id: "event", event_criterion_id: "criterion", respondent_role: "coach", value_json: true }], showClub: false,
    },
  });
  const tree = harness.render(), text = textContent(tree);
  for (const expected of ["Note partagée", "Note interne", "Note validée", "Retour du junior", "5/6", "6/6", "À l’heure"]) assert.ok(text.includes(expected), expected);
  assert.equal(elements(tree).filter((node) => node.type === "a").length, 0, "no activity link without detail permission");
  const noteSections = elements(tree).filter((node) => node.type === "section");
  assert.ok(textContent(noteSections[0]).includes("Note partagée"));
  assert.ok(!textContent(noteSections[0]).includes("Note interne"));
  assert.ok(textContent(noteSections[1]).includes("Note interne"));
});

test("Coach competition workspace uses supplied data without assuming Player identity or offering Player writes", () => {
  let identityReads = 0;
  const harness = coachComponentHarness("components/golf/GolfRoundsWorkspace.tsx", {
    fetch: noFetch, modules: { ...chartMocks, "@/lib/effectivePlayer": { resolveEffectivePlayerContext: () => { identityReads++; throw new Error("Unexpected Player context"); } } },
    props: { readOnly: true, dataset: { rounds: [], holes: [], loading: false } },
  });
  const tree = harness.render();
  assert.equal(identityReads, 0);
  assert.ok(textContent(tree).includes("Aucun parcours enregistré"));
  assert.equal(elements(tree).filter((node) => node.type === "a" && String(node.props.href).startsWith("/player/")).length, 0);
  harness.cleanup();
});

test("shared training dashboard preserves Coach destinations for attendance and evaluation attention", () => {
  const harness = coachComponentHarness("components/golf/TrainingDashboard.tsx", {
    fetch: noFetch, modules: chartMocks, props: {
      sessions: [], items: [], prevSessions: [], prevItems: [], rounds: [], fromDate: "2026-09-01", toDate: "2026-09-30",
      totalMinutes: 0, displayedTrainingCount: 0, overviewObjective: 600, overviewFtemPercent: 0,
      trainingVolumeTarget: { ftem_code: "F2" }, trainingVolumeMotivation: null, weeklyObjectiveMinutes: 120,
      compareLabel: null, periodLabel: "Septembre", trainingAttendanceOverview: { rate: 100, present: 1, total: 1, trend: null },
      loading: false, pendingEvaluationCount: 2, latestCoachEvaluation: null,
      calendarHref: "/coach/players/player?tab=planning", pendingHref: "/coach/calendar?view=evaluations&period=year", onEvaluationsClick: () => {},
    },
  });
  const tree = harness.render();
  const links = elements(tree).filter((node) => node.type === "a").map((node) => node.props.href);
  assert.ok(links.includes("/coach/players/player?tab=planning"));
  assert.ok(links.includes("/coach/calendar?view=evaluations&period=year"));
  assert.ok(!links.some((href) => href.startsWith("/player/")));
  harness.cleanup();
});
