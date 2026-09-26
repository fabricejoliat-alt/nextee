import assert from "node:assert/strict";
import test from "node:test";
import {
  playerConsentAllowsAccess,
  resolvePlayerConsentStatus,
} from "../lib/playerConsent.ts";
import {
  buildPlayerDocumentObjectPath,
  createPlayerDocumentUploadReservation,
  issuePlayerDocumentUploadReservation,
  isOwnedPlayerDocumentPath,
  verifyPlayerDocumentUploadReservation,
} from "../lib/playerDocumentUpload.ts";
import {
  normalizePlayerDocumentMimeType,
  playerDocumentSignatureMatches,
  validatePlayerDocumentFile,
} from "../lib/playerDocumentPolicy.ts";
import {
  guardianCanEdit,
  guardianCanView,
  resolvePlayerSubject,
  selectPrimaryApplicationRole,
  type GuardianAccessLink,
} from "../lib/playerAccessPolicy.ts";

const guardianLinks: GuardianAccessLink[] = [
  {
    playerId: "child-revoked",
    isPrimary: true,
    canView: false,
    canEdit: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    playerId: "child-view-only",
    isPrimary: false,
    canView: true,
    canEdit: false,
    createdAt: "2026-01-02T00:00:00.000Z",
  },
  {
    playerId: "child-editable",
    isPrimary: false,
    canView: null,
    canEdit: true,
    createdAt: "2026-01-03T00:00:00.000Z",
  },
];

test("player subject selection fails closed for revoked or unknown children", () => {
  assert.deepEqual(
    resolvePlayerSubject({
      actorUserId: "parent-1",
      actorRoles: ["parent"],
      guardianLinks,
      requestedPlayerId: "child-revoked",
      mode: "view",
    }),
    { ok: false, reason: "forbidden" }
  );
  assert.deepEqual(
    resolvePlayerSubject({
      actorUserId: "parent-1",
      actorRoles: ["parent"],
      guardianLinks,
      requestedPlayerId: "unknown-child",
      mode: "view",
    }),
    { ok: false, reason: "forbidden" }
  );
  assert.deepEqual(
    resolvePlayerSubject({
      actorUserId: "former-parent",
      actorRoles: [],
      guardianLinks,
      requestedPlayerId: "child-view-only",
      mode: "view",
    }),
    { ok: false, reason: "forbidden" }
  );
});

test("parent edit and consent require both view and edit permissions", () => {
  assert.equal(guardianCanView(guardianLinks[0]), false);
  assert.equal(guardianCanEdit(guardianLinks[0]), false);
  assert.equal(guardianCanView(guardianLinks[2]), true);
  assert.equal(guardianCanEdit(guardianLinks[2]), true);

  const viewSelection = resolvePlayerSubject({
    actorUserId: "parent-1",
    actorRoles: ["parent"],
    guardianLinks,
    mode: "view",
  });
  assert.equal(viewSelection.ok && viewSelection.playerId, "child-view-only");

  const editSelection = resolvePlayerSubject({
    actorUserId: "parent-1",
    actorRoles: ["parent"],
    guardianLinks,
    mode: "consent",
  });
  assert.equal(editSelection.ok && editSelection.playerId, "child-editable");
});

test("multi-role accounts default to self and use a deterministic primary application role", () => {
  const selection = resolvePlayerSubject({
    actorUserId: "multi-role-user",
    actorRoles: ["parent", "player"],
    guardianLinks,
    mode: "view",
  });
  assert.equal(selection.ok && selection.playerId, "multi-role-user");
  assert.equal(selection.ok && selection.isGuardianContext, false);
  assert.equal(selectPrimaryApplicationRole(["parent", "player"]), "player");
  assert.equal(selectPrimaryApplicationRole(["player", "coach"]), "coach");
  assert.equal(selectPrimaryApplicationRole(["coach", "manager"]), "manager");
});

test("player consent fails closed across active memberships", () => {
  assert.equal(resolvePlayerConsentStatus([]), "pending");
  assert.equal(resolvePlayerConsentStatus(["granted"]), "granted");
  assert.equal(resolvePlayerConsentStatus(["adult"]), "adult");
  assert.equal(resolvePlayerConsentStatus(["granted", "adult"]), "granted");
  assert.equal(resolvePlayerConsentStatus(["granted", "pending"]), "pending");
  assert.equal(resolvePlayerConsentStatus(["adult", null]), "pending");
  assert.equal(resolvePlayerConsentStatus(["granted", "refused"]), "refused");
  assert.equal(playerConsentAllowsAccess(["granted", "pending"]), false);
});

test("player document paths stay inside the organization and player prefix", () => {
  const valid = "player-documents/org-1/player-1/123-file.pdf";
  assert.equal(isOwnedPlayerDocumentPath(valid, "org-1", "player-1"), true);
  assert.equal(isOwnedPlayerDocumentPath(valid, "org-1", "player-2"), false);
  assert.equal(isOwnedPlayerDocumentPath("marketplace/items/foreign.jpg", "org-1", "player-1"), false);
  assert.equal(isOwnedPlayerDocumentPath(`${valid}/nested`, "org-1", "player-1"), false);
  const generated = buildPlayerDocumentObjectPath("org-1", "player-1", "analyse finale.pdf");
  assert.equal(isOwnedPlayerDocumentPath(generated, "org-1", "player-1"), true);
  assert.match(generated, /analyse_finale\.pdf$/);
});

test("upload reservations bind every security-relevant field and expire", () => {
  const now = Date.UTC(2026, 8, 26, 10, 0, 0);
  const secret = "test-secret";
  const expected = {
    bucket: "marketplace",
    storagePath: "player-documents/org-1/player-1/123-file.pdf",
    organizationId: "org-1",
    playerId: "player-1",
    uploadedBy: "uploader-1",
    originalName: "file.pdf",
    mimeType: "application/pdf",
    sizeBytes: 42,
    clubEventId: null,
    coachOnly: false,
  };
  const token = createPlayerDocumentUploadReservation(expected, secret, now);
  const firstIssued = issuePlayerDocumentUploadReservation(expected, secret, now);
  const secondIssued = issuePlayerDocumentUploadReservation(expected, secret, now);

  assert.equal(verifyPlayerDocumentUploadReservation(token, expected, secret, now).ok, true);
  assert.notEqual(firstIssued.reservation.reservationId, secondIssued.reservation.reservationId);
  assert.equal(
    verifyPlayerDocumentUploadReservation(
      token,
      { ...expected, storagePath: "marketplace/items/foreign.jpg" },
      secret,
      now
    ).ok,
    false
  );
  assert.equal(
    verifyPlayerDocumentUploadReservation(token, expected, secret, now + 2 * 60 * 60 * 1000 + 1).ok,
    false
  );
});

test("player document policy normalizes and limits supported files", () => {
  assert.equal(normalizePlayerDocumentMimeType("", "analysis.PDF"), "application/pdf");
  assert.equal(
    validatePlayerDocumentFile({
      fileName: "swing.mov",
      mimeType: "video/quicktime",
      sizeBytes: 90 * 1024 * 1024,
    }).ok,
    true
  );
  assert.equal(
    validatePlayerDocumentFile({
      fileName: "swing.mov",
      mimeType: "video/quicktime",
      sizeBytes: 101 * 1024 * 1024,
    }).ok,
    false
  );
  assert.equal(
    validatePlayerDocumentFile({
      fileName: "payload.svg",
      mimeType: "image/svg+xml",
      sizeBytes: 200,
    }).ok,
    false
  );
});

test("player document signatures reject content-type spoofing", () => {
  assert.equal(
    playerDocumentSignatureMatches("application/pdf", new TextEncoder().encode("%PDF-1.7 example")),
    true
  );
  assert.equal(
    playerDocumentSignatureMatches("application/pdf", new TextEncoder().encode("<html>not a pdf</html>")),
    false
  );
  assert.equal(
    playerDocumentSignatureMatches(
      "image/png",
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
    ),
    true
  );
});
