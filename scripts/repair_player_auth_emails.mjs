import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

function loadEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  const envRaw = fs.readFileSync(envPath, "utf8");
  for (const line of envRaw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2] ?? "";
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

function normalizeUsername(value) {
  return String(value ?? "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

function buildNoEmailAddress(userId, username, seed) {
  const fallback = normalizeUsername(username) || `joueur.${String(userId).replace(/-/g, "")}`;
  return `${fallback}.${seed}@noemail.local`;
}

function isNoEmailAddress(email) {
  return String(email ?? "").trim().toLowerCase().endsWith("@noemail.local");
}

function parseArgs(argv) {
  const dryRun = argv.includes("--dry-run");
  const onlyArg = argv.find((arg) => arg.startsWith("--user="));
  const onlyUserId = onlyArg ? onlyArg.slice("--user=".length).trim() : "";
  return { dryRun, onlyUserId };
}

loadEnvFile();

const { dryRun, onlyUserId } = parseArgs(process.argv.slice(2));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const seed = Date.now().toString();

async function main() {
  const playersRes = await supabase
    .from("club_members")
    .select("user_id")
    .eq("role", "player")
    .eq("is_active", true);
  if (playersRes.error) throw new Error(playersRes.error.message);

  const playerIds = Array.from(
    new Set((playersRes.data ?? []).map((row) => String(row.user_id ?? "").trim()).filter(Boolean))
  ).filter((id) => (!onlyUserId ? true : id === onlyUserId));

  const profilesRes = playerIds.length
    ? await supabase.from("profiles").select("id,username,first_name,last_name").in("id", playerIds)
    : { data: [], error: null };
  if (profilesRes.error) throw new Error(profilesRes.error.message);

  const profileById = new Map();
  for (const row of profilesRes.data ?? []) {
    profileById.set(String(row.id ?? ""), row);
  }

  const results = [];
  for (const userId of playerIds) {
    const userRes = await supabase.auth.admin.getUserById(userId);
    const currentEmail = String(userRes.data?.user?.email ?? "").trim().toLowerCase();
    const profile = profileById.get(userId) ?? null;
    const username = String(profile?.username ?? "").trim();
    const nextEmail = buildNoEmailAddress(userId, username, seed);

    if (userRes.error) {
      results.push({
        user_id: userId,
        username,
        status: "error_get_user",
        error: userRes.error.message,
      });
      continue;
    }

    if (isNoEmailAddress(currentEmail)) {
      results.push({
        user_id: userId,
        username,
        current_email: currentEmail,
        next_email: nextEmail,
        status: "already_noemail",
      });
      continue;
    }

    if (dryRun) {
      results.push({
        user_id: userId,
        username,
        current_email: currentEmail || null,
        next_email: nextEmail,
        status: "would_update",
      });
      continue;
    }

    const updateRes = await supabase.auth.admin.updateUserById(userId, {
      email: nextEmail,
      email_confirm: true,
    });

    if (updateRes.error) {
      results.push({
        user_id: userId,
        username,
        current_email: currentEmail || null,
        next_email: nextEmail,
        status: "error_update_user",
        error: updateRes.error.message,
      });
      continue;
    }

    results.push({
      user_id: userId,
      username,
      current_email: currentEmail || null,
      next_email: nextEmail,
      status: "updated",
    });
  }

  const summary = {
    dry_run: dryRun,
    only_user_id: onlyUserId || null,
    scanned: results.length,
    updated: results.filter((row) => row.status === "updated").length,
    already_noemail: results.filter((row) => row.status === "already_noemail").length,
    would_update: results.filter((row) => row.status === "would_update").length,
    errors: results.filter((row) => String(row.status).startsWith("error_")).length,
  };

  console.log(JSON.stringify({ summary, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

