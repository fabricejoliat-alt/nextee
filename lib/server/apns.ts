import { createPrivateKey, createHash, sign } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";

export type ApnsEnvironment = "sandbox" | "production";
export type NativePushDevice = { token: string; environment: ApnsEnvironment; bundleId: string };
export const APNS_BUNDLE_ID = "golf.activitee.app";

export function validNativePushDevice(value: unknown): value is NativePushDevice {
  if (!value || typeof value !== "object") return false;
  const v = value as NativePushDevice;
  return typeof v.token === "string" && /^[a-f\d]{32,512}$/i.test(v.token) && v.token.length % 2 === 0 &&
    (v.environment === "sandbox" || v.environment === "production") && v.bundleId === APNS_BUNDLE_ID;
}

function credentials(environment: ApnsEnvironment) {
  // Separate keys also support Apple's environment-scoped signing keys.
  const prefix = environment === "sandbox" ? "APNS_SANDBOX" : "APNS";
  return { keyId: process.env[`${prefix}_KEY_ID`], key: process.env[`${prefix}_PRIVATE_KEY`]?.replace(/\\n/g, "\n"), teamId: process.env.APNS_TEAM_ID };
}

export function apnsConfigured(environment?: ApnsEnvironment) {
  if (!environment) return apnsConfigured("sandbox") || apnsConfigured("production");
  const c = credentials(environment);
  return Boolean(c.keyId && c.key && c.teamId);
}

const jwtCache = new Map<string, { token: string; issued: number }>();
export function apnsAuthorization(environment: ApnsEnvironment, now = Math.floor(Date.now() / 1000)) {
  const { keyId, key, teamId } = credentials(environment);
  if (!keyId || !key || !teamId) throw new Error("APNs is not configured");
  const cacheKey = createHash("sha256").update(`${keyId}:${teamId}:${key}`).digest("hex");
  const cached = jwtCache.get(cacheKey);
  if (cached && now >= cached.issued && now - cached.issued < 1200) return cached.token;
  const input = `${Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString("base64url")}.${Buffer.from(JSON.stringify({ iss: teamId, iat: now })).toString("base64url")}`;
  const privateKey = createPrivateKey(key);
  if (privateKey.asymmetricKeyType !== "ec" || privateKey.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("APNs requires an ES256 key");
  const signature = sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url");
  const token = `${input}.${signature}`;
  jwtCache.clear();
  jwtCache.set(cacheKey, { token, issued: now });
  return token;
}

function truncateUtf8(value: string, maxBytes: number) {
  let result = "", bytes = 0;
  for (const char of value) { bytes += Buffer.byteLength(char); if (bytes > maxBytes) break; result += char; }
  return result;
}

export function apnsPayload(input: { title: string; body: string; url: string; recipientUserId: string; badgeCount?: number }) {
  const payload = { aps: { alert: { title: truncateUtf8(input.title, 200), body: truncateUtf8(input.body, 2000) }, sound: "default",
    ...(Number.isFinite(input.badgeCount) ? { badge: Math.max(0, Math.floor(input.badgeCount!)) } : {}) },
    url: Buffer.byteLength(input.url) <= 700 ? input.url : "/", recipientUserId: input.recipientUserId };
  // JSON escaping can expand control characters to six bytes each.
  while (Buffer.byteLength(JSON.stringify(payload)) > 4096 && payload.aps.alert.body.length) {
    payload.aps.alert.body = truncateUtf8(payload.aps.alert.body, Math.floor(Buffer.byteLength(payload.aps.alert.body) / 2));
  }
  return JSON.stringify(payload);
}

export function openApnsConnection(environment: ApnsEnvironment) {
  const client = connect(environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
  client.on("error", () => { /* Each request reports its own failure; never log device tokens or credentials. */ });
  client.setTimeout(15000, () => client.destroy());
  return client;
}

export async function sendApns(client: ClientHttp2Session, device: NativePushDevice, payload: string) {
  if (!validNativePushDevice(device) || Buffer.byteLength(payload) > 4096) return { sent: false, stale: false };
  const authorization = apnsAuthorization(device.environment);
  return new Promise<{ sent: boolean; stale: boolean }>(resolve => {
    let settled = false, status = 0, body = "";
    const finish = (sent = false, stale = false) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ sent, stale }); } };
    const request = client.request({ ":method": "POST", ":path": `/3/device/${device.token}`, authorization: `bearer ${authorization}`,
      "apns-topic": device.bundleId, "apns-push-type": "alert", "apns-priority": "10", "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600) });
    const timer = setTimeout(() => { finish(); request.close(); }, 10000);
    request.setEncoding("utf8");
    request.on("response", headers => { status = Number(headers[":status"]); });
    request.on("data", chunk => { if (body.length < 4096) body += chunk; });
    request.on("error", () => finish());
    request.on("close", () => finish());
    request.on("end", () => {
      let reason = "";
      try { reason = JSON.parse(body).reason ?? ""; } catch { /* An empty 200 response is expected. */ }
      finish(status === 200, status === 410 || (status === 400 && reason === "BadDeviceToken"));
    });
    request.end(payload);
  });
}
