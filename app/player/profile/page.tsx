"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabaseClient";
import Cropper from "react-easy-crop";
import { useI18n } from "@/components/i18n/AppI18nProvider";

type ProfileRow = {
  id: string;

  first_name: string | null;
  last_name: string | null;
  username: string | null;
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

  // ✅ NEW — Admin
  avs_no: string | null;

  avatar_url?: string | null; // ✅ NEW
};

type ClubMember = { club_id: string };
type Club = { id: string; name: string | null };

function displayHello(firstName: string | null | undefined, helloLabel: string) {
  const f = (firstName ?? "").trim();
  if (!f) return helloLabel;
  return `${helloLabel} ${f}`;
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

/** Categorys juniors (SwissGolf-style):
 *  - enfants nés en 2016 et + : U10
 *  - 2014 et + : U12
 *  - 2012 et + : U14
 *  - 2010 et + : U16
 *  - 2008 et + : U18
 *  - plus vieux : Amateur
 */
function getJuniorCategory(birthDateISO: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDateISO.trim());
  if (!m) return "—";
  const year = Number(m[1]);
  if (!Number.isFinite(year)) return "—";

  if (year >= 2016) return "U10";
  if (year >= 2014) return "U12";
  if (year >= 2012) return "U14";
  if (year >= 2010) return "U16";
  if (year >= 2008) return "U18";
  return "Amateur";
}

export default function PlayerProfilePage() {
  const router = useRouter();
  const { t } = useI18n();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Avatar upload busy is separate so user can still edit fields
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [viewerRole, setViewerRole] = useState<"player" | "parent">("player");

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

  // ✅ Handicap
  const [handicap, setHandicap] = useState<string>("");

  const [address, setAddress] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");

  // ✅ NEW — Admin
  const [avsNo, setAvsNo] = useState("");

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

  // delta placeholder (idem player)
  const handicapDelta = -0.4;

  async function load() {
    setLoading(true);
    setError(null);
    setInfo(null);

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes.user) {
      setError(t("playerProfile.error.invalidSession"));
      setLoading(false);
      return;
    }

    const uid = userRes.user.id;
    setUserId(uid);
    setEmail(userRes.user.email ?? "");

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token ?? "";
    if (token) {
      const meRes = await fetch("/api/auth/me", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const meJson = await meRes.json().catch(() => ({}));
      const role = meRes.ok ? String(meJson?.membership?.role ?? "player") : "player";
      setViewerRole(role === "parent" ? "parent" : "player");
    } else {
      setViewerRole("player");
    }

    // profile
    const profRes = await supabase
      .from("profiles")
      .select(
        [
          "id",
          "first_name",
          "last_name",
          "username",
          "phone",
          "birth_date",
          "sex",
          "handedness",
          "handicap",
          "address",
          "postal_code",
          "city",
          "avs_no",
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
    setUsername((row as any)?.username ?? "");
    setPhone(row?.phone ?? "");

    setBirthDate(row?.birth_date ?? "");
    setSex(row?.sex ?? "");

    setHandedness((row?.handedness as any) ?? "");

    setHandicap(row?.handicap == null ? "" : String(row.handicap));

    setAddress(row?.address ?? "");
    setPostalCode(row?.postal_code ?? "");
    setCity(row?.city ?? "");

    setAvsNo(row?.avs_no ?? "");

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
    if (Number.isNaN(n)) return null;
    return n;
  }

  async function save() {
    if (!userId) return;

    setBusy(true);
    setError(null);
    setInfo(null);

    const hc = parseHandicap();
    if (viewerRole === "player" && handicap.trim() !== "" && hc === null) {
      setError(t("playerProfile.error.invalidHandicap"));
      setBusy(false);
      return;
    }

    const upsertPayload: Record<string, any> = {
      id: userId,
      first_name: firstName.trim() || null,
      last_name: lastName.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      postal_code: postalCode.trim() || null,
      city: city.trim() || null,
    };

    if (viewerRole === "player") {
      upsertPayload.birth_date = birthDate.trim() || null;
      upsertPayload.sex = sex.trim() || null;
      upsertPayload.handedness = handedness || null;
      upsertPayload.handicap = hc;
      upsertPayload.avs_no = avsNo.trim() || null;
    }

    const { error } = await supabase
      .from("profiles")
      .upsert(upsertPayload, { onConflict: "id" });

    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }

    setInfo(t("playerProfile.saved"));
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
      setError(t("playerProfile.error.unsupportedFormat"));
      return;
    }

    // 4MB limit (ajuste si tu veux)
    if (file.size > 4 * 1024 * 1024) {
      setError(t("playerProfile.error.imageTooLarge"));
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

      setInfo(t("playerProfile.photoUpdated"));
    } catch (err: any) {
      setError(err?.message ?? t("playerProfile.error.avatarUpload"));
    } finally {
      setAvatarBusy(false);
    }
  }

  const handicapNumber = useMemo(() => parseHandicap(), [handicap]);
  const juniorCategory = useMemo(
    () => (birthDate ? getJuniorCategory(birthDate) : "—"),
    [birthDate]
  );

  return (
    <div className="player-dashboard-bg">
      <div className="app-shell">
        {/* ===== SOMMET (comme page player) ===== */}
        <div className="player-hero">
          {/* ===== AVATAR + CTA dessous ===== */}
          <div style={{ display: "grid", justifyItems: "center", gap: 8 }}>
            <div
              className="avatar"
              aria-hidden="true"
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
              title={loading ? "" : t("playerProfile.changePhoto")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
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
                color: "rgba(255,255,255,0.88)",
                cursor: loading || avatarBusy ? "default" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {avatarBusy ? t("playerProfile.uploading") : t("common.change")}
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
            onConfirm={async (croppedBlob) => {
              await uploadAvatarBlob(croppedBlob);
            }}
          />

          <div style={{ minWidth: 0 }}>
            <div className="hero-title">
              {loading
                ? `${t("playerProfile.hello")}…`
                : `${displayHello(firstName, t("playerProfile.hello"))} 👋`}
            </div>

            <div className="hero-sub">
              {viewerRole === "player" ? (
                <div>Handicap {typeof handicapNumber === "number" ? handicapNumber.toFixed(1) : "—"}</div>
              ) : (
                <div>Parent</div>
              )}

              {/* ✅ pastille supprimée (delta-pill) */}
            </div>

            {/* ✅ ici: nom(s) du/des club(s) */}
            <div className="hero-club truncate">{heroClubLine}</div>
          </div>
        </div>

        {error && <div style={{ marginTop: 10, color: "#ffd1d1", fontWeight: 800 }}>{error}</div>}

        {info && <div style={{ marginTop: 10, color: "#d1fae5", fontWeight: 800 }}>{info}</div>}

        {/* ===== GLASS ===== */}
        <section className="glass-section" style={{ marginTop: 14 }}>
          <div className="section-title">{t("common.profile")}</div>

          <div className="glass-card">
            {loading ? (
              <div style={{ opacity: 0.85, fontWeight: 800 }}>{t("common.loading")}</div>
            ) : (
              <div style={{ display: "grid", gap: 16 }}>
                {/* Identité */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>
                    {t("playerProfile.identity")}
                  </div>

                  <div className="grid-2">
                    <Field label={t("playerProfile.firstName")}>
                      <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                    </Field>

                    <Field label={t("playerProfile.lastName")}>
                      <input value={lastName} onChange={(e) => setLastName(e.target.value)} />
                    </Field>
                  </div>

                  {viewerRole === "player" && (
                    <>
                      <Field label={t("playerProfile.birthDate")}>
                        <input
                          type="date"
                          value={birthDate}
                          onChange={(e) => setBirthDate(e.target.value)}
                          style={{ width: "100%", maxWidth: "100%", minWidth: 0, display: "block" }}
                        />
                      </Field>

                      <Field label={t("playerProfile.category")}>
                        <input value={juniorCategory} disabled />
                      </Field>

                      <div className="grid-2">
                        <Field label={t("playerProfile.sex")}>
                          <select value={sex} onChange={(e) => setSex(e.target.value)}>
                            <option value="">—</option>
                            <option value="male">{t("playerProfile.sexMale")}</option>
                            <option value="female">{t("playerProfile.sexFemale")}</option>
                            <option value="other">{t("playerProfile.sexOther")}</option>
                          </select>
                        </Field>

                        <Field label={t("playerProfile.handedness")}>
                          <select
                            value={handedness}
                            onChange={(e) => setHandedness(e.target.value as any)}
                          >
                            <option value="">—</option>
                            <option value="right">{t("playerProfile.handednessRight")}</option>
                            <option value="left">{t("playerProfile.handednessLeft")}</option>
                          </select>
                        </Field>
                      </div>

                      <div style={{ marginTop: 6 }}>
                        <Field label={t("playerProfile.handicap")}>
                          <input
                            inputMode="decimal"
                            placeholder="ex: 25.4"
                            value={handicap}
                            onChange={(e) => setHandicap(e.target.value)}
                            style={{
                              height: 46,
                              fontSize: 18,
                              fontWeight: 900,
                              borderRadius: 12,
                            }}
                          />
                        </Field>
                      </div>
                    </>
                  )}
                </div>

                <div className="hr-soft" />

                {/* Contact */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{t("playerProfile.contact")}</div>

                  <div className="grid-2">
                    <Field label={t("playerProfile.phone")}>
                      <input value={phone} onChange={(e) => setPhone(e.target.value)} />
                    </Field>

                    <Field label={t("playerProfile.emailLogin")}>
                      <input value={email} disabled />
                    </Field>
                  </div>

                  {viewerRole === "parent" && (
                    <>
                      <Field label="Username">
                        <input value={username} disabled />
                      </Field>
                      <div style={{ color: "var(--muted)", fontSize: 12 }}>
                        Le mot de passe se modifie depuis l’espace manager.
                      </div>
                    </>
                  )}
                </div>

                <div className="hr-soft" />

                {/* Adresse */}
                <div style={{ display: "grid", gap: 10 }}>
                  <div className="card-title" style={{ marginBottom: 0 }}>{t("playerProfile.addressSection")}</div>

                  <Field label={t("playerProfile.address")}>
                    <input value={address} onChange={(e) => setAddress(e.target.value)} />
                  </Field>

                  <div className="grid-2">
                    <Field label={t("playerProfile.postalCode")}>
                      <input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                    </Field>

                    <Field label={t("playerProfile.city")}>
                      <input value={city} onChange={(e) => setCity(e.target.value)} />
                    </Field>
                  </div>
                </div>

                {viewerRole === "player" && (
                  <>
                    <div className="hr-soft" />
                    <div style={{ display: "grid", gap: 10 }}>
                      <div className="card-title" style={{ marginBottom: 0 }}>
                        {t("playerProfile.administrative")}
                      </div>

                      <Field label={t("playerProfile.avsNo")}>
                        <input value={avsNo} onChange={(e) => setAvsNo(e.target.value)} />
                      </Field>
                    </div>
                  </>
                )}

                {/* ✅ ENREGISTRER à l’intérieur de la card */}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={save}
                    disabled={!canSave}
                    style={compactBtnStyle}
                  >
                    {busy ? t("playerProfile.saving") : t("common.save")}
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
    <div style={{ display: "grid", gap: 6, minWidth: 0, width: "100%" }}>
      <label className="muted-uc" style={{ color: "rgba(0,0,0,0.55)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

const compactBtnStyle: React.CSSProperties = {
  height: 34,
  padding: "0 12px",
  fontSize: 13,
  fontWeight: 800,
  borderRadius: 10,
};

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

  useEffect(() => {
    if (!open) {
      setCrop({ x: 0, y: 0 });
      setZoom(1);
      setCroppedAreaPixels(null);
    }
  }, [open]);

  if (!open || !imageSrc) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
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
          {t("playerProfile.cropTitle")}
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
              {t("playerProfile.zoom")}
            </div>
            <input
              type="range"
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
              {t("common.cancel")}
            </button>

            <button
              type="button"
              disabled={busy || !croppedAreaPixels}
              className="btn"
              style={{ width: "100%" }}
              onClick={async () => {
                if (!croppedAreaPixels) return;
                const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
                await onConfirm(blob);
                onClose();
              }}
            >
              {busy ? t("playerProfile.saving") : t("playerProfile.validate")}
            </button>
          </div>

          <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(255,255,255,0.7)" }}>
            {t("playerProfile.cropHint")}
          </div>
        </div>
      </div>
    </div>
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
