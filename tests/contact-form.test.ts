import assert from "node:assert/strict";
import { test } from "node:test";
import { loadManagerModule } from "./helpers/managerRouteHarness.ts";

type ContactRoute = { POST: (request: Request) => Promise<Response> };
const body = {
  name: "Visiteur Exemple", email: "visiteur@example.invalid", subject: "Question de test",
  message: "Bonjour, ceci est un message fictif.", website: "", turnstile_token: "test-token",
};
const request = (input = body) => new Request("https://contact.example.invalid/api/contact", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://contact.example.invalid" },
  body: JSON.stringify(input),
});

test("un jeton CAPTCHA rejeté ne déclenche aucun e-mail", async () => {
  const calls: string[] = [];
  const route = loadManagerModule<ContactRoute>("app/api/contact/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server/publicContact": { publicContactEmail: async () => "contact@example.invalid" },
    fetch: async (url: string) => {
      calls.push(url);
      return Response.json({ success: false });
    },
  }, { NODE_ENV: "production", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "real-site-key", TURNSTILE_SECRET_KEY: "real-secret", BREVO_API_KEY: "test-key" });
  const response = await route.POST(request());
  assert.equal(response.status, 403);
  assert.deepEqual(calls, ["https://challenges.cloudflare.com/turnstile/v0/siteverify"]);
});

test("un formulaire validé utilise le destinataire configuré et replyTo", async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const route = loadManagerModule<ContactRoute>("app/api/contact/route.ts", {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/server/publicContact": { publicContactEmail: async () => "contact@example.invalid" },
    fetch: async (url: string, options: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(options.body)) });
      return url.includes("siteverify")
        ? Response.json({ success: true, action: "contact", hostname: "contact.example.invalid" })
        : Response.json({ messageId: "fake" }, { status: 201 });
    },
  }, { NODE_ENV: "production", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "real-site-key", TURNSTILE_SECRET_KEY: "real-secret", BREVO_API_KEY: "test-key", MAIL_FROM: "ActiviTee <noreply@activitee.golf>" });
  const response = await route.POST(request());
  assert.equal(response.status, 201);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://api.brevo.com/v3/smtp/email");
  assert.deepEqual(calls[1].body.to, [{ email: "contact@example.invalid", name: "ActiviTee" }]);
  assert.deepEqual(calls[1].body.replyTo, { email: body.email, name: body.name });
  assert.deepEqual(calls[1].body.sender, { name: "ActiviTee", email: "noreply@activitee.golf" });
});
