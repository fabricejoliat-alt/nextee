import { withAdminMutationAudit } from "@/lib/server/adminAudit";
import { randomPassword } from "@/lib/server/initialPassword";
import { importFieldApplies, type JuniorImportField } from "@/lib/managerImportFields";
import { encodeMemberFieldValue } from "@/lib/memberFieldValues";
import { activeClubMember, canReuseClubAccount, requireManagerClub } from "@/lib/server/managerAccess";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}



function normalizeToken(input: string) {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\.{2,}/g, ".");
}

function normalizeBirthDateInput(raw: string) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/);
  if (!match) return null;

  let first = Number(match[1]);
  let second = Number(match[2]);
  let year = Number(match[3]);
  if (!Number.isFinite(first) || !Number.isFinite(second) || !Number.isFinite(year)) return null;
  if (year < 100) year += year >= 30 ? 1900 : 2000;
  let day = first;
  let month = second;

  if (first <= 12 && second > 12) {
    month = first;
    day = second;
  } else if (first > 12 && second <= 12) {
    day = first;
    month = second;
  } else {
    day = first;
    month = second;
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

function normalizePlayerFieldOptions(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => String(item ?? "").trim()).filter(Boolean);
}

function normalizeLegacyCourseTrackValue(
  field: { options_json?: string[] | null },
  rawValue: unknown
) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;

  const configuredOptions = Array.isArray(field.options_json)
    ? field.options_json.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  if (configuredOptions.length > 0) {
    return configuredOptions.includes(value) ? value : "__invalid__";
  }

  return value === "junior" || value === "competition" || value === "no_course" ? value : "__invalid__";
}

async function findAuthUserByEmail(supabaseAdmin: any, emailInput: string) {
  if (!emailInput) return null;
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const users = data.users ?? [];
    const match = users.find((user: { email?: string }) => (user.email ?? "").toLowerCase() === emailInput);
    if (match) return match;
    if (users.length < 200) return null;
  }
}

async function generateUniqueUsername(
  supabaseAdmin: any,
  firstName: string,
  lastName: string,
  ignoreUserId?: string
) {
  const first = normalizeToken(firstName);
  const last = normalizeToken(lastName);
  const baseRaw = [first, last].filter(Boolean).join(".");
  const base = baseRaw || `user.${Date.now().toString().slice(-6)}`;

  let candidate = base;
  let suffix = 1;
  while (suffix <= 500) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", candidate)
      .limit(5);

    if (error) throw new Error(error.message);
    const takenByOther = (data ?? []).some((r: any) => String(r.id) !== String(ignoreUserId ?? ""));
    if (!takenByOther) return candidate;

    suffix += 1;
    candidate = `${base}${suffix}`;
  }

  throw new Error("Impossible de générer un username unique.");
}

async function resolveExistingUserId(
  supabaseAdmin: any,
  clubId: string,
  role: string,
  emailInput: string,
  avsNo: string,
  firstName: string,
  lastName: string,
  birthDate: string | null
): Promise<string | null> {
  const useEmailAsPrimaryKey = role !== "player";

  if (useEmailAsPrimaryKey && emailInput) {
    const existing = await findAuthUserByEmail(supabaseAdmin, emailInput);
    if (existing?.id) return existing.id as string;
  }

  if (avsNo) {
    const avsRes = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("avs_no", avsNo)
      .limit(2);
    if (avsRes.error) throw new Error(avsRes.error.message);
    const ids = Array.from(new Set((avsRes.data ?? []).map((row: any) => String(row.id ?? "")).filter(Boolean)));
    if (ids.length === 1) return String(ids[0] ?? "");
  }

  if (firstName && lastName && birthDate) {
    const profileRes = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("first_name", firstName)
      .eq("last_name", lastName)
      .eq("birth_date", birthDate)
      .limit(5);
    if (profileRes.error) throw new Error(profileRes.error.message);
    const ids = Array.from(new Set((profileRes.data ?? []).map((row: any) => String(row.id ?? "")).filter(Boolean)));
    if (ids.length > 0) {
      const membershipRes = await supabaseAdmin
        .from("club_members")
        .select("user_id")
        .eq("club_id", clubId)
        .in("user_id", ids)
        .limit(5);
      if (membershipRes.error) throw new Error(membershipRes.error.message);
      const membershipIds = Array.from(
        new Set((membershipRes.data ?? []).map((row: any) => String(row.user_id ?? "")).filter(Boolean))
      );
      if (membershipIds.length === 1) return String(membershipIds[0] ?? "");
    }
  }

  return null;
}

async function resolveExistingPlayerConsentStatus(supabaseAdmin: any, userId: string) {
  const { data, error } = await supabaseAdmin
    .from("club_members")
    .select("player_consent_status")
    .eq("user_id", userId)
    .eq("role", "player")
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  const statuses = (data ?? []).map((row: any) => String(row?.player_consent_status ?? ""));
  if (statuses.includes("granted")) return "granted";
  if (statuses.includes("refused")) return "refused";
  if (statuses.includes("adult")) return "adult";
  if (statuses.includes("pending")) return "pending";
  return null;
}

async function syncLinkedParentsToClub(supabaseAdmin: any, clubId: string, playerUserId: string) {
  const { data: links, error: linksError } = await supabaseAdmin
    .from("player_guardians")
    .select("guardian_user_id")
    .eq("player_id", playerUserId);

  if (linksError) throw new Error(linksError.message);

  const guardianIds = Array.from(
    new Set(
      ((links ?? []) as Array<{ guardian_user_id: string | null }>)
        .map((row) => String(row.guardian_user_id ?? "").trim())
        .filter(Boolean)
    )
  );

  if (guardianIds.length === 0) return;

  const parentMembershipRows = guardianIds.map((guardianUserId) => ({
    club_id: clubId,
    user_id: guardianUserId,
    role: "parent" as const,
    is_active: true,
  }));

  const { error: parentMembershipError } = await supabaseAdmin
    .from("club_members")
    .upsert(parentMembershipRows, { onConflict: "club_id,user_id,role", ignoreDuplicates: true });

  if (parentMembershipError) throw new Error(parentMembershipError.message);
}

export const POST = withAdminMutationAudit(async function POST(req: NextRequest, ctx: any) {
  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceRoleKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const params = await Promise.resolve(ctx?.params);
const clubId: string | undefined = params?.clubId;
    if (!clubId) {
      return NextResponse.json({ error: "Missing clubId in route params" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    const emailInput = (body?.email ?? "").trim().toLowerCase();
    const first_name = (body?.first_name ?? "").trim();
    const last_name = (body?.last_name ?? "").trim();
    const phone = (body?.phone ?? "").trim();
    const staffFunction = (body?.staff_function ?? "").trim();
    const birthDate = normalizeBirthDateInput(body?.birth_date ?? "");
    const address = (body?.address ?? "").trim();
    const postalCode = (body?.postal_code ?? "").trim();
    const city = (body?.city ?? "").trim();
    const avsNo = (body?.avs_no ?? "").trim();
    const sex = (body?.sex ?? "").trim();
    const handedness = (body?.handedness ?? "").trim();
    const handicapValue = Number(body?.handicap);
    const handicap = Number.isFinite(handicapValue) ? handicapValue : null;
    const isPerformance = Boolean(body?.is_performance);
    const consentStatus = ["granted", "pending", "refused", "adult"].includes(String(body?.player_consent_status ?? ""))
      ? String(body.player_consent_status)
      : null;
    const role = (body?.role ?? "").trim(); // manager | coach | player | parent
    const playerId = role === "parent" ? String(body?.player_id ?? "").trim() : "";
    const playerFieldValues =
      body?.player_field_values && typeof body.player_field_values === "object"
        ? (body.player_field_values as Record<string, unknown>)
        : {};

    if (!role || !["manager", "coach", "player", "parent"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const auth = await requireManagerClub(req, supabaseAdmin, clubId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
    if (playerId && !(await activeClubMember(supabaseAdmin, clubId, playerId, "player"))) {
      return NextResponse.json({ error: "Junior introuvable dans ce club." }, { status: 404 });
    }

    const fieldIds = Object.keys(playerFieldValues);
    const { data: fields, error: fieldsError } = fieldIds.length
      ? await supabaseAdmin.from("club_player_fields").select("id,label,field_type,options_json,legacy_binding,applies_to_roles,is_active,scope,is_sensitive,editable_by").eq("club_id", clubId).in("id", fieldIds)
      : { data: [], error: null };
    if (fieldsError) return NextResponse.json({ error: fieldsError.message }, { status: 400 });
    const fieldById = new Map<string, JuniorImportField>((fields ?? []).map((field: JuniorImportField) => [String(field.id), field]));
    try {
      for (const [id, raw] of Object.entries(playerFieldValues)) {
        const field = fieldById.get(id);
        if (!field || (field.legacy_binding ? role !== "player" : !(field.applies_to_roles?.length ? field.applies_to_roles : ["player"]).includes(role)) || (!auth.isSuperadmin && !importFieldApplies(field, role))) {
          return NextResponse.json({ error: "manager.junior.import.templateStale" }, { status: 400 });
        }
        encodeMemberFieldValue(field, raw);
      }
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Champ invalide" }, { status: 400 });
    }

    // 1) Créer l’utilisateur Auth (admin)
    const tempPassword = randomPassword();
    const existingUserId = await resolveExistingUserId(
      supabaseAdmin,
      clubId,
      role,
      emailInput,
      avsNo,
      first_name,
      last_name,
      birthDate
    );
    if (playerId && existingUserId === playerId) {
      return NextResponse.json({ error: "Le compte du junior ne peut pas être utilisé comme son propre compte parent." }, { status: 400 });
    }
    if (existingUserId && !auth.isSuperadmin && !(await canReuseClubAccount(supabaseAdmin, clubId, existingUserId, role))) {
      return NextResponse.json({ error: "Ce compte existe déjà, mais son rattachement n’est pas autorisé depuis ce club. Contactez l’administration de la plateforme ; aucune demande ne lui a été envoyée automatiquement." }, { status: 409 });
    }
    const authUserWithSameEmail = emailInput ? await findAuthUserByEmail(supabaseAdmin, emailInput) : null;
    const mustUseTechnicalEmail =
      !existingUserId &&
      role === "player" &&
      Boolean(emailInput) &&
      Boolean(authUserWithSameEmail?.id);
    const email =
      mustUseTechnicalEmail || !emailInput
        ? `member.${Date.now()}.${Math.floor(Math.random() * 10000)}@noemail.local`
        : emailInput;

    let userId: string;
    let username: string | null = null;

    if (existingUserId) {
      userId = existingUserId;
      const { data: existingProfile, error: existingProfileErr } = await supabaseAdmin
        .from("profiles")
        .select("username,first_name,last_name")
        .eq("id", userId)
        .maybeSingle();
      if (existingProfileErr) {
        return NextResponse.json({ error: existingProfileErr.message }, { status: 400 });
      }

      username =
        (typeof existingProfile?.username === "string" && existingProfile.username.trim() !== ""
          ? existingProfile.username.trim().toLowerCase()
          : null);
    } else {
      username = await generateUniqueUsername(supabaseAdmin, first_name, last_name);
      const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
        email,
        password: tempPassword,
        email_confirm: true,
        app_metadata: { initial_password_required: true },
        user_metadata: {
          username,
          role,
        },
      });

      if (createErr || !created.user) {
        return NextResponse.json({ error: createErr?.message ?? "Create user failed" }, { status: 400 });
      }

      userId = created.user.id;
    }

    // 2) Upsert profile
    const { error: profErr } = existingUserId ? { error: null } : await supabaseAdmin
      .from("profiles")
      .upsert(
        {
          id: userId,
          first_name: first_name || null,
          last_name: last_name || null,
          phone: phone || null,
          birth_date: birthDate,
          address: address || null,
          postal_code: postalCode || null,
          city: city || null,
          avs_no: avsNo || null,
          sex: sex || null,
          handedness: handedness || null,
          handicap,
          staff_function: role === "manager" || role === "coach" ? (staffFunction || null) : null,
          username,
          app_role: role || null,
        },
        { onConflict: "id" }
      );

    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 400 });
    }

    // 3) Inscrire dans le club_members
    const inheritedConsentStatus =
      role === "player" && userId ? await resolveExistingPlayerConsentStatus(supabaseAdmin, userId) : null;

    const { data: memberRow, error: memErr } = await supabaseAdmin
      .from("club_members")
      .upsert(
        {
          club_id: clubId,
          user_id: userId,
          role,
          is_active: true,
          is_performance: role === "player" ? isPerformance : false,
          player_consent_status: role === "player" ? consentStatus ?? inheritedConsentStatus ?? "pending" : null,
        },
        { onConflict: "club_id,user_id,role" }
      )
      .select("id")
      .single();

    if (memErr) {
      if (role === "parent" && existingUserId && memErr.code === "23505") {
        return NextResponse.json({ error: "L’ajout du rôle parent à ce compte nécessite la mise à jour de la base de données du club.", code: "MEMBERSHIP_ROLES_MIGRATION_REQUIRED" }, { status: 503 });
      }
      return NextResponse.json({ error: memErr.message }, { status: 400 });
    }

    if (memberRow?.id) {
      if (role === "player") await syncLinkedParentsToClub(supabaseAdmin, clubId, userId);

      if (fieldIds.length > 0) {
        for (const [fieldId, rawValue] of Object.entries(playerFieldValues)) {
          const field = fieldById.get(fieldId);
          if (!field) continue;

          if (field.legacy_binding === "player_course_track") {
            const next = normalizeLegacyCourseTrackValue(field, rawValue);
            if (next === "__invalid__") {
              return NextResponse.json({ error: `Valeur invalide pour ${fieldId}` }, { status: 400 });
            }
            const { error } = await supabaseAdmin.from("club_members").update({ player_course_track: next }).eq("id", memberRow.id);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
            continue;
          }
          if (field.legacy_binding === "player_membership_paid") {
            const { error } = await supabaseAdmin
              .from("club_members")
              .update({ player_membership_paid: rawValue == null || rawValue === "" ? null : Boolean(rawValue) })
              .eq("id", memberRow.id);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
            continue;
          }
          if (field.legacy_binding === "player_playing_right_paid") {
            const { error } = await supabaseAdmin
              .from("club_members")
              .update({ player_playing_right_paid: rawValue == null || rawValue === "" ? null : Boolean(rawValue) })
              .eq("id", memberRow.id);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
            continue;
          }

          const encoded = encodeMemberFieldValue(field, rawValue);
          const isEmpty = encoded === null;

          if (isEmpty) {
            const { error } = await supabaseAdmin
              .from("club_member_player_field_values")
              .delete()
              .eq("club_member_id", memberRow.id)
              .eq("field_id", fieldId);
            if (error) return NextResponse.json({ error: error.message }, { status: 400 });
            continue;
          }

          const valuePatch = { club_member_id: memberRow.id, field_id: fieldId, ...encoded };

          const { error } = await supabaseAdmin
            .from("club_member_player_field_values")
            .upsert(valuePatch, { onConflict: "club_member_id,field_id" });
          if (error) return NextResponse.json({ error: error.message }, { status: 400 });
        }
      }
    }

    // Réponse (on ne renvoie le mot de passe que si user nouveau)
    return NextResponse.json(
      {
        user: { id: userId, email: emailInput || null },
        member: { id: memberRow?.id ?? null },
        tempPassword: existingUserId ? null : tempPassword,
        username,
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
});
