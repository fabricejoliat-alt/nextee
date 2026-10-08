"use client";

import { organizationFetch as fetch } from "@/lib/organizationFetch";
import Link from "next/link";

import ProfileCustomFieldControl from "@/components/ProfileCustomFieldControl";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import Cropper from "react-easy-crop";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import CoachListSkeleton from "@/components/coach/CoachListSkeleton";
import AccessibleDialog from "@/components/ui/AccessibleDialog";
import styles from "./CoachProfile.module.css";

type ProfileRow = {
  id: string;

  first_name: string | null;
  last_name: string | null;
  phone: string | null;

  birth_date: string | null; // ISO YYYY-MM-DD
  sex: string | null;

  // ✅ NEW
  handedness: "right" | "left" | "" | null;

  // ✅ Handicap
  handicap: number | null;

  address: string | null;
  postal_code: string | null;
  city: string | null;
  staff_function: string | null;

  avatar_url?: string | null; // ✅ NEW
};

type ClubMember = { club_id: string };
type Club = { id: string; name: string | null; org_type: string };
type ProfileCustomField = {
  id: string;
  field_key: string;
  label: string;
  field_type: "text" | "short_text" | "long_text" | "number" | "date" | "boolean" | "select" | "radio" | "checkbox";
  options_json: string[];
  visible_in_profile: boolean;
  editable_in_profile: boolean;
  value: string | boolean | string[] | null;
};
type ProfileCustomFieldGroup = {
  member_id: string;
  club_id: string;
  club_name: string;
  role: "player" | "parent" | "coach" | "manager";
  fields: ProfileCustomField[];
};

function displayHello(hello: string, firstName?: string | null) {
  const f = (firstName ?? "").trim();
  if (!f) return hello;
  return `${hello} ${f}`;
}

function getInitials(firstName?: string | null, lastName?: string | null) {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();

  const firstInitial = f ? f[0].toUpperCase() : "";
  const lastInitial = l ? l[0].toUpperCase() : "";

  if (!firstInitial && !lastInitial) return "👤";
  return `${firstInitial}${lastInitial}`;
}

function isAllowedImage(file: File) {
  const okTypes = ["image/jpeg", "image/png", "image/webp"];
  return okTypes.includes(file.type);
}

function normalizeDisplayEmail(raw: string | null | undefined) {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.endsWith("@noemail.local")) return "";
  return email;
}



export default function CoachProfilePage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const saveLock = useRef(false);
  const avatarLock = useRef(false);

  // Avatar upload busy is separate so user can still edit fields
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");

  // clubs (comme page player)
  const [clubs, setClubs] = useState<Club[]>([]);
  const [customFieldGroups, setCustomFieldGroups] = useState<ProfileCustomFieldGroup[]>([]);
  const heroClubLine = useMemo(() => {
    const names = clubs.filter(c=>c.name).map(c=>`${c.name} · ${t(`organization.${c.org_type}`)}`);
    if (names.length === 0) return "—";
    return names.join(" • ");
  }, [clubs, t]);

  // form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  const [birthDate, setBirthDate] = useState(""); // YYYY-MM-DD
  const [sex, setSex] = useState(""); // "male" | "female" | "other" | ""

  // ✅ NEW
  const [handedness, setHandedness] = useState<"right" | "left" | "">("");

  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [staffFunction, setStaffFunction] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const canSave = loaded && !loading && !busy && !avatarBusy;

  // ✅ Avatar
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const avatarFallback =
    "https://images.unsplash.com/photo-1535131749006-b7f58c99034b?auto=format&fit=crop&w=240&q=60";

  const [avatarDbUrl, setAvatarDbUrl] = useState<string | null>(null); // stored in profiles.avatar_url

  // ✅ REFRESH: clé dédiée pour forcer le reload de l'image
  const [avatarRefreshKey, setAvatarRefreshKey] = useState<number>(() => Date.now());

  // Crop modal state
  const [cropOpen, setCropOpen] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  // ✅ REFRESH: utiliser avatarRefreshKey (et pas Date.now()) pour garantir un changement contrôlé
  const avatarUrl = useMemo(() => {
    const base = avatarDbUrl || avatarFallback;
    if (base.startsWith("blob:")) return base;
    return `${base}${base.includes("?") ? "&" : "?"}t=${avatarRefreshKey}`;
  }, [avatarDbUrl, avatarFallback, avatarRefreshKey]);

  async function load() {
    setLoading(true);
    setLoaded(false);
    setError(null);
    setInfo(null);
    try {
    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      throw new Error("Missing session");
    }

    const uid = userRes.user.id;
    setUserId(uid);
    setEmail(normalizeDisplayEmail(userRes.user.email));

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    if (token) {
      const customFieldsRes = await fetch("/api/profile/custom-fields", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const customFieldsJson = await customFieldsRes.json().catch(() => ({}));
      if (!customFieldsRes.ok) {
        throw new Error("Custom fields unavailable");
      } else {
        const memberships = Array.isArray(customFieldsJson?.memberships) ? customFieldsJson.memberships : [];
        setCustomFieldGroups(
          memberships.filter(
            (membership): membership is ProfileCustomFieldGroup =>
              membership &&
              typeof membership === "object" &&
              membership.role === "coach" &&
              Array.isArray(membership.fields)
          )
        );
      }
    } else {
      throw new Error("Missing session token");
    }

    // profile
    const profRes = await supabase
      .from("profiles")
      .select(
        [
          "id",
          "first_name",
          "last_name",
          "phone",
          "birth_date",
          "sex",
          "handedness",
          "address",
          "postal_code",
          "city",
          "staff_function",
          "avatar_url",
        ].join(",")
      )
      .eq("id", uid)
      .maybeSingle();

    if (profRes.error) {
      throw new Error("Profile unavailable");
    }

    const row = (profRes.data ?? null) as unknown as ProfileRow | null;
    setFirstName(row?.first_name ?? "");
    setLastName(row?.last_name ?? "");
    setPhone(row?.phone ?? "");

    setBirthDate(row?.birth_date ?? "");
    setSex(row?.sex ?? "");

    setHandedness(row?.handedness === "right" || row?.handedness === "left" ? row.handedness : "");

    setAddress(row?.address ?? "");
    setPostalCode(row?.postal_code ?? "");
    setCity(row?.city ?? "");
    setStaffFunction(row?.staff_function ?? "");

    setAvatarDbUrl(row?.avatar_url ?? null);

    // ✅ REFRESH (optionnel mais utile): force un refresh quand on recharge la page
    setAvatarRefreshKey(Date.now());

    // clubs (comme player page)
    const memRes = await supabase
      .from("club_members")
      .select("club_id")
      .eq("user_id", uid)
      .eq("is_active", true);

    if (!memRes.error) {
      const cids = ((memRes.data ?? []) as ClubMember[])
        .map((m) => m.club_id)
        .filter(Boolean);

      if (cids.length > 0) {
        const clubsRes = await supabase.from("organizations").select("id,name,org_type").in("id", cids);
        if (!clubsRes.error) setClubs((clubsRes.data ?? []) as Club[]);
        else setClubs(cids.map((id) => ({ id, name: null, org_type:"club" })));
      } else {
        setClubs([]);
      }
    } else {
      // pas bloquant pour le profil
      setClubs([]);
    }

    setLoaded(true);
    } catch {
      setError("coach.profile.loadError");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);
  useEffect(() => () => { if (cropImageSrc?.startsWith("blob:")) URL.revokeObjectURL(cropImageSrc); }, [cropImageSrc]);

  async function save() {
    if (!userId || !canSave || saveLock.current || avatarLock.current) return;
    saveLock.current = true;
    setBusy(true);
    setError(null);
    setInfo(null);

    let profileSaved = false;
    try {
    const nextPassword = newPassword;
    const nextPasswordConfirm = confirmPassword;
    if (nextPassword || nextPasswordConfirm) {
      if (nextPassword.length < 8) {
        setError("coach.profile.passwordShort");
        return;
      }
      if (nextPassword !== nextPasswordConfirm) {
        setError("coach.profile.passwordMismatch");
        return;
      }
    }

    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: userId,
          first_name: firstName.trim() || null,
          last_name: lastName.trim() || null,
          phone: phone.trim() || null,

          birth_date: birthDate.trim() || null,
          sex: sex.trim() || null,

          handedness: handedness || null,

          address: address.trim() || null,
          postal_code: postalCode.trim() || null,
          city: city.trim() || null,
          staff_function: staffFunction.trim() || null,
        },
        { onConflict: "id" }
      );

    if (error) {
      throw new Error("Profile save failed");
    }
    profileSaved = true;

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    const editableCustomFieldUpdates = customFieldGroups
      .map((group) => ({
        member_id: group.member_id,
        values: Object.fromEntries(
          group.fields
            .filter((field) => field.editable_in_profile)
            .map((field) => [field.id, field.value ?? null])
        ),
      }))
      .filter((group) => Object.keys(group.values).length > 0);

    if (editableCustomFieldUpdates.length > 0) {
      if (!token) throw new Error("Missing session token");
      const customFieldsRes = await fetch("/api/profile/custom-fields", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ updates: editableCustomFieldUpdates }),
      });
      if (!customFieldsRes.ok) {
        throw new Error("Custom fields save failed");
      }
    }

    if (nextPassword) {
      const { error: passwordError } = await supabase.auth.updateUser({ password: nextPassword });
      if (passwordError) {
        throw new Error("Password update failed");
      }
      setNewPassword("");
      setConfirmPassword("");
    }

    setInfo("coach.profile.saved");
    } catch {
      setError(profileSaved ? "coach.profile.partialError" : "coach.profile.saveError");
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  function openFilePicker() {
    if (!canSave || !userId) return;
    setError(null);
    setInfo(null);
    fileInputRef.current?.click();
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file || !userId || !canSave) return;

    setError(null);
    setInfo(null);

    if (!isAllowedImage(file)) {
      setError("coach.profile.photoFormat");
      return;
    }

    // 4MB limit (ajuste si tu veux)
    if (file.size > 4 * 1024 * 1024) {
      setError("coach.profile.photoSize");
      return;
    }

    // open crop modal
    if (cropImageSrc?.startsWith("blob:")) URL.revokeObjectURL(cropImageSrc);
    const src = URL.createObjectURL(file);
    setCropImageSrc(src);
    setCropOpen(true);
  }

  async function uploadAvatarBlob(blob: Blob) {
    if (!userId || !canSave || avatarLock.current || saveLock.current) return false;
    avatarLock.current = true;

    setError(null);
    setInfo(null);
    setAvatarBusy(true);

    try {
      const objectPath = `${userId}/avatar.jpg`; // normalize to JPG

      const uploadRes = await supabase.storage.from("avatars").upload(objectPath, blob, {
        upsert: true,
        contentType: "image/jpeg",
        cacheControl: "3600",
      });

      if (uploadRes.error) throw new Error(uploadRes.error.message);

      const pub = supabase.storage.from("avatars").getPublicUrl(objectPath);
      const publicUrl = pub.data.publicUrl;

      const { error: upErr } = await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", userId);

      if (upErr) throw new Error(upErr.message);

      setAvatarDbUrl(publicUrl);

      // ✅ REFRESH: bump de la clé juste après succès => l'image se recharge tout de suite
      setAvatarRefreshKey(Date.now());

      setInfo("coach.profile.photoSaved");
      return true;
    } catch {
      setError("coach.profile.photoError");
      return false;
    } finally {
      avatarLock.current = false;
      setAvatarBusy(false);
    }
  }

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell">
        {/* ===== SOMMET (comme page player) ===== */}
        <div className="player-hero">
          {/* ===== AVATAR + CTA dessous ===== */}
          <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
            <div
              className="avatar"
              role="button"
              aria-label={t("coach.profile.changePhoto")}
              aria-disabled={!canSave}
              tabIndex={0}
              onClick={openFilePicker}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); openFilePicker(); }
              }}
              style={{
                cursor: loading || avatarBusy ? "default" : "pointer",
                position: "relative",
                overflow: "hidden",
              }}
              title={loading ? "" : t("coach.profile.changePhoto")}
            >
              {avatarDbUrl ? (
                // Profile uploads are user-controlled public storage URLs, rendered without optimization.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    opacity: avatarBusy ? 0.65 : 1,
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                    fontSize: 28,
                    letterSpacing: 1,
                    color: "white",
                    background: "linear-gradient(135deg, #14532d 0%, #064e3b 100%)",
                  }}
                >
                  {getInitials(firstName, lastName)}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={openFilePicker}
              disabled={loading || avatarBusy || !userId}
              style={{
                background: "transparent",
                border: "none",
                padding: 0,
                fontWeight: 900,
                fontSize: 12,
                letterSpacing: 0.6,
                textTransform: "uppercase",
                color: "rgba(255,255,255,0.88)",
                cursor: loading || avatarBusy ? "default" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {avatarBusy ? t("coach.profile.uploading") : t("coach.profile.changePhoto")}
            </button>
          </div>

          {/* input hidden */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            onChange={onPickAvatar}
          />

          {/* Crop modal */}
          <CropAvatarModal
            open={cropOpen}
            imageSrc={cropImageSrc}
            busy={avatarBusy}
            onClose={() => {
              setCropOpen(false);
              if (cropImageSrc?.startsWith("blob:")) URL.revokeObjectURL(cropImageSrc);
              setCropImageSrc(null);
            }}
            onConfirm={uploadAvatarBlob}
          />

          <div style={{ minWidth: 0 }}>
            <h1 className="hero-title">{loading ? `${t("coach.profile.hello")}…` : `${displayHello(t("coach.profile.hello"), firstName)} 👋`}</h1>

            <div className="hero-sub">
              <div>
                HCP PRO
              </div>

              {/* ✅ pastille supprimée (delta-pill) */}
            </div>

            {/* ✅ ici: nom(s) du/des club(s) */}
            <div className="hero-club truncate">{heroClubLine}</div>
          </div>
        </div>

        {error && <div className={styles.error} role="alert">{t(error)}{!loaded && !loading ? <button type="button" className="btn" onClick={() => void load()}>{t("coach.retry")}</button> : null}</div>}

        {info && <div className={styles.success} role="status">{t(info)}</div>}

        <p style={{ margin: "12px 0" }}><Link href="/legal/my">Documents et consentements</Link> · <Link href="/legal/request">Mes données</Link></p>
        {/* ===== GLASS ===== */}
        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">{t("coach.profile.title")}</div>

          <div className="glass-card">
            {loading ? (
              <CoachListSkeleton label={t("coach.profile.loading")} />
            ) : loaded ? (
              <fieldset disabled={busy || avatarBusy} className={styles.fields}>
                {/* Identité */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("coach.profile.identity")}</div>

                  <div className="grid-2">
                    <Field label={t("coach.profile.firstName")}>
                      <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </Field>

                    <Field label={t("coach.profile.lastName")}>
                      <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </Field>
                  </div>

                  {/* ✅ Date de naissance sur une ligne */}
                  <Field label={t("coach.profile.birthDate")}>
                    <input
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                    />
                  </Field>

                  <div className="grid-2">
                    <Field label={t("coach.profile.sex")}>
                      <select value={sex} onChange={(e) => setSex(e.target.value)}>
                        <option value="">—</option>
                        <option value="male">{t("coach.profile.male")}</option>
                        <option value="female">{t("coach.profile.female")}</option>
                        <option value="other">{t("coach.profile.other")}</option>
                      </select>
                    </Field>

                    {/* ✅ NEW */}
                    <Field label={t("coach.profile.handedness")}>
                      <select
                        value={handedness}
                        onChange={(e) => setHandedness(e.target.value === "left" || e.target.value === "right" ? e.target.value : "")}
                      >
                        <option value="">—</option>
                        <option value="right">{t("coach.profile.right")}</option>
                        <option value="left">{t("coach.profile.left")}</option>
                      </select>
                    </Field>
                  </div>

                  {/* ✅ HCP PRO (coach) */}
                  <div style={{ marginTop: 6 }}>
                    <Field label="HCP">
                      <input
                        value="PRO"
                        disabled
                        style={{
                          height: 46,
                          fontSize: 18,
                          fontWeight: 900,
                          borderRadius: 12,
                        }}
                      />
                    </Field>
                  </div>
                </div>

                <div className="hr-soft" />

                {/* Contact */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("coach.profile.contact")}</div>

                  <div className="grid-2">
                    <Field label={t("coach.profile.phone")}>
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </Field>

                    <Field label={t("coach.profile.email")}>
                      <input value={email} disabled />
                    </Field>
                  </div>
                  <Field label={t("coach.profile.function")}>
                    <input
                      value={staffFunction}
                      onChange={(e) => setStaffFunction(e.target.value)}
                      placeholder={t("coach.profile.functionHint")}
                    />
                  </Field>
                </div>

                <div className="hr-soft" />

                {customFieldGroups.length > 0 ? (
                  <>
                    <div style={{ display: "grid", gap: 14 }}>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {t("coach.profile.organization")}</div>

                      {customFieldGroups.map((group) => (
                        <div key={group.member_id} style={{ display: "grid", gap: 10 }}>
                          <div className="muted-uc" style={{ color: "rgba(0,0,0,0.55)" }}>
                            {group.club_name}
                          </div>
                          <div className="grid-2">
                            {group.fields.map((field) => (
                              <Field key={`${group.member_id}-${field.id}`} label={field.label}>
                                <ProfileCustomFieldControl field={field} name={`${group.member_id}-${field.id}`} disabled={!field.editable_in_profile} yes={t("coach.profile.yes")} no={t("coach.profile.no")}
                                    onChange={(value) => setCustomFieldGroups((previous) => previous.map((currentGroup) => currentGroup.member_id !== group.member_id ? currentGroup : {
                                      ...currentGroup, fields: currentGroup.fields.map((currentField) => currentField.id !== field.id ? currentField : { ...currentField, value }),
                                    }))} />
                                </Field>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="hr-soft" />
                  </>
                ) : null}

                {/* Adresse */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("coach.profile.address")}</div>

                  <Field label={t("coach.profile.address")}>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} />
                  </Field>

                  <div className="grid-2">
                    <Field label={t("coach.profile.postalCode")}>
                      <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                    </Field>

                    <Field label={t("coach.profile.city")}>
                      <input value={city} onChange={(e) => setCity(e.target.value)} />
                    </Field>
                  </div>
                </div>

                <div className="hr-soft" />

                {/* Sécurité */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("coach.profile.security")}</div>

                  <div className="grid-2">
                    <Field label={t("coach.profile.password")}>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder={t("coach.profile.passwordHint")}
                      />
                    </Field>

                    <Field label={t("coach.profile.confirmPassword")}>
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder={t("coach.profile.confirmPassword")}
                      />
                    </Field>
                  </div>
                </div>

                <div className="hr-soft" />

                {/* ✅ ENREGISTRER à l’intérieur de la card */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                  <button
                    className="cta-green cta-green-inline"
                    type="button"
                    onClick={save}
                    disabled={!canSave}
                    style={{ height: 34, padding: "0 12px", fontSize: 13, fontWeight: 800, borderRadius: 10 }}
                  >
                    {busy ? t("coach.directory.saving") : t("common.save")}
                  </button>
                </div>
              </fieldset>
            ) : null}
          </div>

          {/* ✅ Logout supprimé */}
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={id} className="muted-uc" style={{ color: "rgba(0,0,0,0.55)" }}>
        {label}
      </label>
      {React.isValidElement<{ id?: string }>(children) ? React.cloneElement(children, { id }) : children}
    </div>
  );
}

/* =========================
   Crop Modal + Helpers
   ========================= */

type CropAvatarModalProps = {
  open: boolean;
  imageSrc: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (blob: Blob) => Promise<boolean>;
};

function CropAvatarModal({ open, imageSrc, busy, onClose, onConfirm }: CropAvatarModalProps) {
  const { t } = useI18n();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const working = busy || processing;
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (!open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
      setError(false);
    }
  }, [open]);

  if (!open || !imageSrc) return null;

  return (
    <AccessibleDialog className={styles.cropDialog} labelledBy="coach-crop-title" onClose={() => { if (!working) onClose(); }}>
        <div id="coach-crop-title" className={styles.cropTitle}>
          {t("coach.profile.crop")}
        </div>

        <div className={styles.cropPreview}>
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={1}
            cropShape="round"
            showGrid={false}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, areaPixels) => setCroppedAreaPixels(areaPixels)}
          />
        </div>

        <div className={styles.cropControls}>
          {error ? <div className={styles.error} role="alert">{t("coach.profile.photoError")}</div> : null}
          <div className={styles.cropZoom}>
            <label htmlFor="coach-crop-zoom">{t("coach.profile.zoom")}</label>
            <input
              id="coach-crop-zoom"
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              disabled={working}
            />
          </div>

          <div className={styles.cropActions}>
            <button
              type="button"
              onClick={onClose}
              disabled={working}
              className="btn"
            >
              {t("common.cancel")}</button>

            <button
              type="button"
              disabled={working || !croppedAreaPixels}
              className="cta-green"
              onClick={async () => {
                if (!croppedAreaPixels || working || lock.current) return;
                lock.current = true;
                setProcessing(true);
                setError(false);
                try {
                  const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
                  if (await onConfirm(blob)) onClose(); else setError(true);
                } catch {
                  setError(true);
                } finally {
                  lock.current = false;
                  setProcessing(false);
                }
              }}
            >
              {working ? t("coach.directory.saving") : t("common.save")}
            </button>
          </div>

          <div className={styles.cropHint}>
            {t("coach.profile.cropHint")}
          </div>
        </div>
    </AccessibleDialog>
  );
}

async function getCroppedImageBlob(
  imageSrc: string,
  cropPixels: { x: number; y: number; width: number; height: number }
) {
  const img = await loadImage(imageSrc);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported.");

  const outSize = 512;
  canvas.width = outSize;
  canvas.height = outSize;

  ctx.drawImage(
    img,
    cropPixels.x,
    cropPixels.y,
    cropPixels.width,
    cropPixels.height,
    0,
    0,
    outSize,
    outSize
  );

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Cannot generate cropped image."));
        resolve(blob);
      },
      "image/jpeg",
      0.9
    );
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
