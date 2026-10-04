"use client";
import Link from "next/link";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/components/i18n/AppI18nProvider";
import { supabase } from "@/lib/supabaseClient";
import Cropper from "react-easy-crop";
import { CompactLoadingBlock } from "@/components/ui/LoadingBlocks";

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
type Club = { id: string; name: string | null };

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

function normalizeDisplayEmail(rawEmail?: string | null) {
  const email = (rawEmail ?? "").trim().toLowerCase();
  if (!email) return "";
  if (email.endsWith("@noemail.local")) return "";
  return rawEmail ?? "";
}

function sanitizeEditableEmail(rawEmail?: string | null) {
  const v = String(rawEmail ?? "").trim();
  if (!v) return "";
  if (v.toLowerCase().endsWith("@noemail.local")) return "";
  return v;
}

function translateAuthMessage(message: string, t: (key: string) => string) {
  if (message === "New password should be different from the old password.") {
    return t("manager.profile.samePassword");
  }
  return message;
}

export default function ManagerProfilePage() {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Avatar upload busy is separate so user can still edit fields
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [authEmailRaw, setAuthEmailRaw] = useState("");
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordEditable, setPasswordEditable] = useState(false);

  // clubs (comme page player)
  const [clubs, setClubs] = useState<Club[]>([]);
  const heroClubLine = useMemo(() => {
    const names = clubs.map((c) => c.name).filter(Boolean) as string[];
    if (names.length === 0) return "—";
    return names.join(" • ");
  }, [clubs]);

  // form
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");

  const [birthDate, setBirthDate] = useState(""); // YYYY-MM-DD
  const [sex, setSex] = useState(""); // "male" | "female" | "other" | ""

  // ✅ NEW
  const [handedness, setHandedness] = useState<"right" | "left" | "">("");
  const [handicap, setHandicap] = useState("");

  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [staffFunction, setStaffFunction] = useState("");

  const canSave = useMemo(() => !busy && !avatarBusy, [busy, avatarBusy]);

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
    setError(null);
    setInfo(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setError(t("manager.profile.invalidSession"));
      setLoading(false);
      return;
    }

    const uid = userRes.user.id;
    const rawEmail = userRes.user.email ?? "";
    setUserId(uid);
    setAuthEmailRaw(rawEmail);
    setEmail(normalizeDisplayEmail(rawEmail));

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
          "handicap",
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
      setError(profRes.error.message);
      setLoading(false);
      return;
    }

    const row = (profRes.data ?? null) as unknown as ProfileRow | null;
    setFirstName(row?.first_name ?? "");
    setLastName(row?.last_name ?? "");
    setPhone(row?.phone ?? "");

    setBirthDate(row?.birth_date ?? "");
    setSex(row?.sex ?? "");

    setHandedness(row?.handedness === "left" || row?.handedness === "right" ? row.handedness : "");
    setHandicap(row?.handicap == null ? "" : String(row.handicap));

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
        const clubsRes = await supabase.from("clubs").select("id,name").in("id", cids);
        if (!clubsRes.error) setClubs((clubsRes.data ?? []) as Club[]);
        else setClubs(cids.map((id) => ({ id, name: null })));
      } else {
        setClubs([]);
      }
    } else {
      // pas bloquant pour le profil
      setClubs([]);
    }

    setLoading(false);
  }

  useEffect(() => {
    load();
    return () => {
      // cleanup when unmount (if crop src is a blob URL)
      if (cropImageSrc?.startsWith("blob:")) URL.revokeObjectURL(cropImageSrc);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function parseHandicap(): number | null {
    const v = handicap.trim();
    if (v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  async function save() {
    if (!userId) return;

    setBusy(true);
    setError(null);
    setInfo(null);

    if (newPassword.trim() || confirmPassword.trim()) {
      if (newPassword.length < 8) {
        setError(t("manager.profile.passwordShort"));
        setBusy(false);
        return;
      }
      if (newPassword !== confirmPassword) {
        setError(t("manager.profile.passwordMismatch"));
        setBusy(false);
        return;
      }
    }

    const emailTrimmed = sanitizeEditableEmail(email).toLowerCase();
    const emailNormalized = normalizeDisplayEmail(emailTrimmed).trim().toLowerCase();
    const currentEmailNormalized = normalizeDisplayEmail(authEmailRaw).trim().toLowerCase();

    if (emailTrimmed && !emailNormalized) {
      setError(t("manager.profile.realEmail"));
      setBusy(false);
      return;
    }
    if (emailNormalized && !emailNormalized.includes("@")) {
      setError(t("manager.profile.invalidEmail"));
      setBusy(false);
      return;
    }
    const handicapValue = parseHandicap();
    if (handicap.trim() !== "" && handicapValue == null) {
      setError(t("manager.profile.invalidHandicap"));
      setBusy(false);
      return;
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
          handicap: handicapValue,

          address: address.trim() || null,
          postal_code: postalCode.trim() || null,
          city: city.trim() || null,
          staff_function: staffFunction.trim() || null,
        },
        { onConflict: "id" }
      );

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    // Update login email only when user explicitly entered a value and it changed.
    if (emailNormalized && emailNormalized !== currentEmailNormalized) {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token ?? "";
      const emailRes = await fetch("/api/auth/update-email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ email: emailNormalized }),
      });
      const emailJson = await emailRes.json().catch(() => ({}));
      if (!emailRes.ok) {
        setError(String(emailJson?.error ?? t("manager.profile.emailError")));
        setBusy(false);
        return;
      }
      setAuthEmailRaw(emailNormalized);
      setEmail(emailNormalized);
    }

    if (newPassword.trim()) {
      const { error: authError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (authError) {
        setError(translateAuthMessage(authError.message, t));
        setBusy(false);
        return;
      }
      setNewPassword("");
      setConfirmPassword("");
    }

    setInfo(t("manager.profile.saved"));
    setBusy(false);
  }

  function openFilePicker() {
    if (loading || avatarBusy || !userId) return;
    setError(null);
    setInfo(null);
    fileInputRef.current?.click();
  }

  async function onPickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    e.target.value = "";
    if (!file || !userId) return;

    setError(null);
    setInfo(null);

    if (!isAllowedImage(file)) {
      setError(t("manager.profile.photoFormat"));
      return;
    }

    // 4MB limit (ajuste si tu veux)
    if (file.size > 4 * 1024 * 1024) {
      setError(t("manager.profile.photoSize"));
      return;
    }

    // open crop modal
    if (cropImageSrc?.startsWith("blob:")) URL.revokeObjectURL(cropImageSrc);
    const src = URL.createObjectURL(file);
    setCropImageSrc(src);
    setCropOpen(true);
  }

  async function uploadAvatarBlob(blob: Blob) {
    if (!userId) return;

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

      setInfo(t("manager.profile.photoSaved"));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t("manager.profile.photoError"));
    } finally {
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
              aria-label={t("manager.profile.changePhoto")}
              role="button"
              tabIndex={0}
              onClick={openFilePicker}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") openFilePicker();
              }}
              style={{
                cursor: loading || avatarBusy ? "default" : "pointer",
                position: "relative",
                overflow: "hidden",
              }}
              title={loading ? "" : t("manager.profile.changePhoto")}
            >
              {avatarDbUrl ? (
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
                color: "rgba(0,0,0,0.85)",
                cursor: loading || avatarBusy ? "default" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {avatarBusy ? t("manager.profile.uploading") : t("manager.profile.changePhoto")}
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
          {cropOpen && cropImageSrc ? <CropAvatarModal
            open={cropOpen}
            imageSrc={cropImageSrc}
            busy={avatarBusy}
            onClose={() => {
              setCropOpen(false);
              if (cropImageSrc?.startsWith("blob:")) URL.revokeObjectURL(cropImageSrc);
              setCropImageSrc(null);
            }}
            onConfirm={async (croppedBlob) => {
              await uploadAvatarBlob(croppedBlob);
            }}
          /> : null}

          <div style={{ minWidth: 0 }}>
            <div className="hero-title">{loading ? t("manager.profile.hello") : `${displayHello(t("manager.profile.hello"), firstName)} 👋`}</div>

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

        {error && <div style={{ marginTop: 10, color: "#ffd1d1", fontWeight: 800 }}>{error}</div>}

        {info && <div style={{ marginTop: 10, color: "#d1fae5", fontWeight: 800 }}>{info}</div>}

        {/* ===== GLASS ===== */}
        <p style={{ margin: "12px 0" }}><Link href="/legal/my">Documents et consentements</Link> · <Link href="/legal/request">Mes données</Link></p>
        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">{t("manager.profile.title")}</div>

          <div className="glass-card">
            {loading ? (
              <CompactLoadingBlock label={t("manager.profile.loading")} />
            ) : (
                <div style={{ display: "grid", gap: 16 }}>
                <input
                  type="text"
                  autoComplete="username"
                  tabIndex={-1}
                  aria-hidden="true"
                  style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
                />
                <input
                  type="password"
                  autoComplete="current-password"
                  tabIndex={-1}
                  aria-hidden="true"
                  style={{ position: "absolute", opacity: 0, width: 1, height: 1, pointerEvents: "none" }}
                />
                {/* Identité */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("manager.profile.identity")}
                  </div>

                  <div className="grid-2">
                    <Field label={t("manager.profile.firstName")}>
                      <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </Field>

                    <Field label={t("manager.profile.lastName")}>
                      <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </Field>
                  </div>

                  {/* ✅ Date de naissance sur une ligne */}
                  <Field label={t("manager.profile.birthDate")}>
                    <input
                      type="date"
                      value={birthDate}
                      onChange={(e) => setBirthDate(e.target.value)}
                    />
                  </Field>

                  <div className="grid-2">
                    <Field label={t("manager.profile.sex")}>
                      <select value={sex} onChange={(e) => setSex(e.target.value)}>
                        <option value="">—</option>
                        <option value="male">{t("manager.profile.male")}</option>
                        <option value="female">{t("manager.profile.female")}</option>
                        <option value="other">{t("manager.profile.other")}</option>
                      </select>
                    </Field>

                    {/* ✅ NEW */}
                    <Field label={t("manager.profile.handedness")}>
                      <select
                        value={handedness}
                        onChange={(e) => setHandedness(e.target.value as "right" | "left" | "")}
                      >
                        <option value="">—</option>
                        <option value="right">{t("manager.profile.right")}</option>
                        <option value="left">{t("manager.profile.left")}</option>
                      </select>
                    </Field>
                  </div>

                  {/* ✅ HCP */}
                  <div style={{ marginTop: 6 }}>
                    <Field label="HCP">
                      <input
                        type="number"
                        step="0.1"
                        inputMode="decimal"
                        value={handicap}
                        onChange={(e) => setHandicap(e.target.value)}
                        placeholder={t("manager.profile.handicapExample")}
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
                    {t("manager.profile.contact")}
                  </div>

                  <div className="grid-2">
                    <Field label={t("manager.profile.phone")}>
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </Field>

                    <Field label={t("manager.profile.email")}>
                      <input
                        type="email"
                        name="manager_profile_email"
                        autoComplete="off"
                        value={email}
                        onChange={(e) => setEmail(sanitizeEditableEmail(e.target.value))}
                        onBlur={(e) => setEmail(sanitizeEditableEmail(e.target.value))}
                        placeholder="name@domain.com"
                      />
                    </Field>
                  </div>
                  <Field label={t("manager.profile.function")}>
                    <input
                      value={staffFunction}
                      onChange={(e) => setStaffFunction(e.target.value)}
                      placeholder={t("manager.profile.functionHint")}
                    />
                  </Field>
                </div>

                <div className="hr-soft" />

                {/* Mot de passe */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("manager.profile.passwordSection")}
                  </div>

                  <div className="grid-2">
                    <Field label={t("manager.profile.password")}>
                      <input
                        type="password"
                        name="manager_new_password"
                        autoComplete="new-password"
                        readOnly={!passwordEditable}
                        onFocus={() => setPasswordEditable(true)}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder={t("manager.profile.passwordHint")}
                      />
                    </Field>

                    <Field label={t("manager.profile.confirmPassword")}>
                      <input
                        type="password"
                        name="manager_confirm_password"
                        autoComplete="new-password"
                        readOnly={!passwordEditable}
                        onFocus={() => setPasswordEditable(true)}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder={t("manager.profile.repeatPassword")}
                      />
                    </Field>
                  </div>
                </div>

                <div className="hr-soft" />

                {/* Adresse */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("manager.profile.address")}
                  </div>

                  <Field label={t("manager.profile.address")}>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} />
                  </Field>

                  <div className="grid-2">
                    <Field label={t("manager.profile.postalCode")}>
                      <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                    </Field>

                    <Field label={t("manager.profile.city")}>
                      <input value={city} onChange={(e) => setCity(e.target.value)} />
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
                    {busy ? t("manager.profile.saving") : t("manager.profile.save")}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ✅ Logout supprimé */}
        </section>

        <div style={{ height: 12 }} />
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span className="muted-uc" style={{ color: "rgba(0,0,0,0.55)" }}>
        {label}
      </span>
      {children}
    </label>
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
  onConfirm: (blob: Blob) => Promise<void> | void;
};

function CropAvatarModal({ open, imageSrc, busy, onClose, onConfirm }: CropAvatarModalProps) {
  const { t } = useI18n();
  const [crop, setCrop] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  if (!open || !imageSrc) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("manager.profile.crop")}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        style={{
          width: "min(520px, 92vw)",
          borderRadius: 18,
          overflow: "hidden",
          background: "rgba(255,255,255,0.10)",
          border: "1px solid rgba(255,255,255,0.18)",
          backdropFilter: "blur(10px)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ padding: 14, fontWeight: 900, color: "rgba(255,255,255,0.92)" }}>
          {t("manager.profile.crop")}
        </div>

        <div style={{ position: "relative", height: 340, background: "rgba(0,0,0,0.35)" }}>
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

        <div style={{ padding: 14, display: "grid", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "rgba(255,255,255,0.85)" }}>
              {t("manager.profile.zoom")}
            </div>
            <input
              type="range"
              aria-label={t("manager.profile.zoom")}
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              disabled={busy}
              style={{ width: "100%" }}
            />
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="btn"
              style={{ width: "100%", opacity: busy ? 0.65 : 1 }}
            >
              {t("manager.profile.cancel")}
            </button>

            <button
              type="button"
              disabled={busy || !croppedAreaPixels}
              className="btn"
              style={{ width: "100%" }}
              onClick={async () => {
                if (!croppedAreaPixels) return;
                const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels, t);
                await onConfirm(blob);
                onClose();
              }}
            >
              {busy ? t("manager.profile.saving") : t("manager.profile.confirm")}
            </button>
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.7)" }}>
            {t("manager.profile.cropHint")}
          </div>
        </div>
      </div>
    </div>
  );
}

async function getCroppedImageBlob(
  imageSrc: string,
  cropPixels: { x: number; y: number; width: number; height: number },
  t: (key: string) => string
) {
  const img = await loadImage(imageSrc);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(t("manager.profile.canvasError"));

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
        if (!blob) return reject(new Error(t("manager.profile.cropError")));
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
