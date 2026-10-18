import assert from "node:assert/strict";
import test from "node:test";
import { nationalityFlag, nationalityName, nationalityOptions, normalizeNationality } from "../lib/nationalities.ts";
import { coachComponentHarness, elements, textContent, flush, type Element } from "./helpers/coachComponentHarness.ts";
import { loadManagerModule, managerDatabase } from "./helpers/managerRouteHarness.ts";

const button = (tree: Element, label: string) => {
  const found = elements(tree).find(node => node.type === "button" && (textContent(node).trim() === label || node.props["aria-label"] === label));
  assert.ok(found, `Missing button: ${label}`);
  return found;
};

function profileFixture(nationality: string | null = null, avatar: string | null = null) {
  const row = { id: "player", first_name: "Alex", last_name: "Test", nationality, avatar_url: avatar, handicap: 12.4 };
  const { db } = managerDatabase({ profiles: [row], club_members: [] });
  const writes: Record<string, unknown>[] = [];
  const avatarRequests: string[] = [];
  let failUpload = false;
  const originalFrom = db.from.bind(db);
  const database = {
    auth: { getUser: async () => ({ data: { user: { id: "player" } } }), getSession: async () => ({ data: { session: { access_token: "test-only" } } }) },
    from: (table: string) => {
      const query = originalFrom(table);
      return { ...query, upsert: async (patch: Record<string, unknown>) => {
        assert.equal(table, "profiles"); assert.equal(patch.id, "player");
        writes.push(patch); Object.assign(row, patch); return { error: null };
      } };
    },
  };
  const fetcher: typeof fetch = async (input, options) => {
    const url = String(input);
    if (url === "/api/profile/avatar") {
      avatarRequests.push(options?.method ?? "GET");
      if (options?.method === "POST") {
        assert.ok((options.body as FormData).get("image") instanceof File);
        return failUpload ? Response.json({ error: "Upload indisponible" }, { status: 500 }) : Response.json({ avatar_url: "https://example.invalid/avatar.jpg" });
      }
      assert.equal(options?.method, "DELETE"); return Response.json({ ok: true });
    }
    assert.ok(["/api/auth/me", "/api/parent/children", "/api/profile/custom-fields", "/api/profile/handicap-history"].includes(url), url);
    return Response.json({ membership: { role: "player" }, children: [], memberships: [], entries: [] });
  };
  const harness = coachComponentHarness("app/player/profile/page.tsx", {
    fetch: fetcher, database,
    modules: {
      "react-easy-crop": { __esModule: true, default: "cropper" },
      "next/image": { __esModule: true, default: "img" },
      "@/components/auth/BiometricLockSettings": { __esModule: true, default: "biometric-settings" },
      "@/components/player/PlayerBreadcrumb": { __esModule: true, default: "breadcrumb" },
      "@/components/ProfileCustomFieldControl": { __esModule: true, default: "custom-field" },
    },
  });
  return { harness, writes, row, avatarRequests, failUpload: () => { failUpload = true; } };
}

async function loaded(fixture: ReturnType<typeof profileFixture>) {
  fixture.harness.render(); await flush(); return fixture.harness.render();
}

// All writes below stay in the fixture; no profile, photo or nationality is changed remotely.
test("country options cover all ISO countries plus Kosovo, localize and sort without duplicates", () => {
  for (const locale of ["fr", "en", "de", "it"]) {
    const options = nationalityOptions(locale);
    assert.equal(options.length, 250);
    assert.equal(new Set(options.map(option => option.code)).size, 250);
    assert.ok(options.every((option, index) => !index || options[index - 1].label.localeCompare(option.label, locale) <= 0));
    assert.ok(options.every(option => option.label && nationalityFlag(option.code)));
  }
  assert.equal(nationalityName("CH", "fr"), "Suisse");
  assert.equal(nationalityName("DE", "de"), "Deutschland");
  assert.equal(normalizeNationality(" ch "), "CH");
  assert.equal(nationalityFlag("FR"), "🇫🇷");
  assert.equal(nationalityFlag("CH"), "🇨🇭");
  for (const value of [null, undefined, "", "EU", "ZZ", "INVALID"]) assert.equal(nationalityFlag(value), null);
});

test("nationality loads, saves on the current profile and can be cleared without changing protected names", async () => {
  // Only browser timers are needed by the existing save flash.
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout: () => 1, clearTimeout: () => {} } });
  const fixture = profileFixture("CH");
  try {
    let tree = await loaded(fixture);
    const selector = () => elements(fixture.harness.render()).find(node => node.type === "select" && node.props["aria-label"] === "Nationalité")!;
    assert.equal(selector().props.value, "CH");
    assert.ok(textContent(tree).includes("Alex Test"));
    selector().props.onChange({ target: { value: "FR" } });
    await button(fixture.harness.render(), "Enregistrer le profil").props.onClick();
    assert.equal(fixture.row.nationality, "FR");
    assert.equal(fixture.writes[0].id, "player");
    assert.ok(!("first_name" in fixture.writes[0]));
    assert.ok(!("last_name" in fixture.writes[0]));
    selector().props.onChange({ target: { value: "" } });
    await button(fixture.harness.render(), "Profil enregistré !").props.onClick();
    assert.equal(fixture.row.nationality, null);
    fixture.harness.setLocale("de"); tree = fixture.harness.render();
    assert.ok(elements(tree).some(node => node.type === "select" && node.props["aria-label"] === "Nationalität"));
  } finally {
    fixture.harness.cleanup();
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow); else Reflect.deleteProperty(globalThis, "window");
  }
});

test("photo control supports adding, cropping, replacing and removing through the existing authenticated API", async () => {
  const fixture = profileFixture();
  try {
    button(await loaded(fixture), "Modifier la photo de profil").props.onClick();
    let tree = fixture.harness.render();
    button(tree, "Ajouter une photo");
    assert.ok(!textContent(tree).includes("Supprimer la photo"));
    const crop = elements(tree).find(node => "onConfirm" in node.props)!;
    assert.equal(await crop.props.onConfirm(new Blob(["synthetic image"], { type: "image/jpeg" })), true);
    tree = fixture.harness.render();
    button(tree, "Changer la photo"); button(tree, "Recadrer la photo");
    button(tree, "Supprimer la photo").props.onClick(); await flush();
    button(fixture.harness.render(), "Modifier la photo de profil").props.onClick();
    button(fixture.harness.render(), "Ajouter une photo");
    assert.deepEqual(fixture.avatarRequests, ["POST", "DELETE"]);
  } finally { fixture.harness.cleanup(); }
});

test("failed avatar upload reports failure so crop can stay open for retry", async () => {
  const fixture = profileFixture(null, "https://example.invalid/previous.jpg");
  try {
    const tree = await loaded(fixture); fixture.failUpload();
    const crop = elements(tree).find(node => "onConfirm" in node.props)!;
    assert.equal(await crop.props.onConfirm(new Blob(["synthetic image"], { type: "image/jpeg" })), false);
    assert.ok(textContent(fixture.harness.render()).includes("Upload indisponible"));
  } finally { fixture.harness.cleanup(); }
});

test("home receives the nationality of the authorized subject, including a parent's selected child", async () => {
  const { db, mocks } = managerDatabase({ profiles: [{ id: "child", nationality: "CH" }, { id: "parent", nationality: "FR" }], organizations: [], club_members: [] });
  const originalFrom = db.from.bind(db);
  db.from = (table: string) => {
    const query = originalFrom(table), select = query.select.bind(query);
    query.select = (columns, options) => { if (table === "profiles") assert.ok(columns?.split(",").includes("nationality")); return select(columns, options); };
    return query;
  };
  const route = loadManagerModule<{ GET: (req: Request) => Promise<Response> }>("app/api/player/context/route.ts", {
    ...mocks,
    "@/app/api/player/access": {
      bearerTokenFromRequest: () => "test-only",
      resolveAuthenticatedPlayerAccess: async () => ({ supabaseAdmin: db, subjectPlayerId: "child", actorUserId: "parent", viewerRole: "parent", actorRoles: ["parent"], guardianLinks: [], organizationIds: [], permissions: { view: true, edit: false } }),
      visibleGuardianLinks: () => [], playerAccessErrorStatus: () => 500,
    },
  });
  const response = await route.GET(new Request("http://localhost/api/player/context?home=1&child_id=child"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).home.profile.nationality, "CH");
});
