"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BarChart3,
  Bell,
  Check,
  CheckCircle2,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Filter,
  Info,
  LoaderCircle,
  Menu,
  Map,
  MoreHorizontal,
  MapPin,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import * as echarts from "echarts";
import styles from "./design-system.module.css";
import { AttendanceToggle } from "@/components/ui/AttendanceToggle";

type PaletteKey = "primary" | "secondary" | "accent";

const initialPalette = {
  primary: "#35483B",
  secondary: "#899D7D",
  accent: "#D9A441",
};

const hexToRgb = (hex: string) => {
  const value = hex.replace("#", "");
  const normalized = value.length === 3 ? value.split("").map((char) => char + char).join("") : value;
  const number = Number.parseInt(normalized, 16);
  return `${(number >> 16) & 255}, ${(number >> 8) & 255}, ${number & 255}`;
};

const chartData = [
  { day: "L", value: 22 },
  { day: "M", value: 38 },
  { day: "M", value: 30 },
  { day: "J", value: 54 },
  { day: "V", value: 44 },
  { day: "S", value: 66 },
  { day: "D", value: 58 },
];

const barData = [
  { day: "L", value: 22 },
  { day: "M", value: 38 },
  { day: "M", value: 30 },
  { day: "J", value: 54 },
  { day: "V", value: 44 },
  { day: "S", value: 66 },
  { day: "D", value: 58 },
];

const horizontalBarData = [
  { label: "Technique", value: 86 },
  { label: "Physique", value: 68 },
  { label: "Mental", value: 54 },
  { label: "Récupération", value: 42 },
];

type EchartsGalleryVariant = "line" | "curve" | "bars" | "horizontalBars" | "progress" | "ring";

function buildEchartsOption(variant: EchartsGalleryVariant, colors: string[]): echarts.EChartsOption {
  const primary = colors[0] ?? "#35483B";
  const secondary = colors[1] ?? "#899D7D";

  if (variant === "line" || variant === "curve") {
    return {
      animation: true,
      animationDuration: 1400,
      animationEasing: "cubicOut",
      grid: { left: 10, right: 10, top: 18, bottom: 18, containLabel: true },
      xAxis: {
        type: "category",
        data: chartData.map((entry) => entry.day),
        axisLine: { lineStyle: { color: "rgba(53,72,59,0.12)" } },
        axisTick: { show: false },
        axisLabel: { color: "#7d8780", fontWeight: 700, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: "rgba(53,72,59,0.08)" } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#fff",
        borderColor: "#e2e7e1",
        borderWidth: 1,
        textStyle: { color: "#17211b", fontWeight: 600 },
        extraCssText: "box-shadow:0 16px 32px rgba(27,45,33,.12);border-radius:12px;",
      },
      series: [
        {
          type: "line",
          data: chartData.map((entry) => entry.value),
          smooth: variant === "curve",
          symbol: "circle",
          symbolSize: 8,
          lineStyle: { color: primary, width: 3.2 },
          itemStyle: { color: "#fff", borderColor: primary, borderWidth: 2 },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(53,72,59,0.18)" },
                { offset: 1, color: "rgba(53,72,59,0)" },
              ],
            },
          },
          animationDelay: () => 80,
        },
      ],
    };
  }

  if (variant === "bars") {
    return {
      animation: true,
      animationDuration: 1100,
      animationEasing: "elasticOut",
      grid: { left: 10, right: 10, top: 18, bottom: 18, containLabel: true },
      xAxis: {
        type: "category",
        data: barData.map((entry) => entry.day),
        axisLine: { lineStyle: { color: "rgba(53,72,59,0.12)" } },
        axisTick: { show: false },
        axisLabel: { color: "#7d8780", fontWeight: 700, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        axisLabel: { show: false },
        splitLine: { lineStyle: { color: "rgba(53,72,59,0.08)" } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      tooltip: {
        trigger: "axis",
        backgroundColor: "#fff",
        borderColor: "#e2e7e1",
        borderWidth: 1,
        textStyle: { color: "#17211b", fontWeight: 600 },
        extraCssText: "box-shadow:0 16px 32px rgba(27,45,33,.12);border-radius:12px;",
      },
      series: [
        {
          type: "bar",
          data: barData.map((entry) => entry.value),
          barWidth: 18,
          barCategoryGap: "42%",
          showBackground: true,
          backgroundStyle: {
            color: "#edf2ed",
            borderRadius: 0,
          },
          itemStyle: {
            borderRadius: [8, 8, 0, 0],
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "#9DB39A" },
                { offset: 1, color: primary },
              ],
            },
          },
          animationDelay: (index) => index * 80,
        },
      ],
    };
  }

  if (variant === "horizontalBars") {
    return {
      animation: true,
      animationDuration: 1100,
      animationEasing: "elasticOut",
      grid: { left: 22, right: 16, top: 16, bottom: 12, containLabel: true },
      xAxis: {
        type: "value",
        max: 100,
        axisLabel: { show: false },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "rgba(53,72,59,0.08)" } },
      },
      yAxis: {
        type: "category",
        data: horizontalBarData.map((entry) => entry.label),
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: "#5f695f", fontWeight: 700, fontSize: 11, margin: 14 },
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: "#fff",
        borderColor: "#e2e7e1",
        borderWidth: 1,
        textStyle: { color: "#17211b", fontWeight: 600 },
        extraCssText: "box-shadow:0 16px 32px rgba(27,45,33,.12);border-radius:12px;",
      },
      series: [
        {
          type: "bar",
          data: horizontalBarData.map((entry) => entry.value),
          barWidth: 16,
          showBackground: true,
          backgroundStyle: {
            color: "#edf2ed",
            borderRadius: [0, 999, 999, 0],
          },
          itemStyle: {
            borderRadius: [0, 999, 999, 0],
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 1,
              y2: 0,
              colorStops: [
                { offset: 0, color: primary },
                { offset: 1, color: secondary },
              ],
            },
          },
          animationDelay: (index) => index * 85,
        },
      ],
    };
  }

  if (variant === "ring") {
    return {
      animation: true,
      animationDuration: 1600,
      animationEasing: "backOut",
      tooltip: {
        trigger: "item",
        backgroundColor: "#fff",
        borderColor: "#e2e7e1",
        borderWidth: 1,
        textStyle: { color: "#17211b", fontWeight: 600 },
        extraCssText: "box-shadow:0 16px 32px rgba(27,45,33,.12);border-radius:12px;",
      },
      series: [
        {
          type: "pie",
          radius: ["64%", "84%"],
          center: ["50%", "50%"],
          animationType: "scale",
          animationEasing: "backOut",
          silent: true,
          label: { show: false },
          labelLine: { show: false },
          data: [
            {
              value: 60,
              name: "Complété",
              itemStyle: {
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 1,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: "#CFE0CB" },
                    { offset: 1, color: primary },
                  ],
                },
              },
            },
            { value: 40, name: "Restant", itemStyle: { color: "#edf2ed" } },
          ],
        },
      ],
    };
  }

  return {
    animation: true,
    animationDuration: 1200,
    animationEasing: "cubicOut",
    grid: { left: 16, right: 16, top: 18, bottom: 18, containLabel: true },
    xAxis: {
      type: "value",
      max: 100,
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "category",
      data: ["Objectif"],
      axisLabel: { color: "#5f695f", fontWeight: 800, fontSize: 11, margin: 16 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: "#fff",
      borderColor: "#e2e7e1",
      borderWidth: 1,
      textStyle: { color: "#17211b", fontWeight: 600 },
      extraCssText: "box-shadow:0 16px 32px rgba(27,45,33,.12);border-radius:12px;",
    },
    graphic: [
      {
        type: "text",
        left: "center",
        top: "middle",
        style: {
          text: "60%",
          fill: primary,
          font: "900 24px var(--font-inter-tight), var(--font-inter), sans-serif",
        },
      },
      {
        type: "text",
        left: "center",
        top: "56%",
        style: {
          text: "sur 100%",
          fill: "#7d8780",
          font: "800 10px var(--font-inter), sans-serif",
        },
      },
    ],
    series: [
      {
        type: "bar",
        data: [60],
        barWidth: 18,
        showBackground: true,
        backgroundStyle: {
            color: "#edf2ed",
          borderRadius: [0, 999, 999, 0],
        },
        itemStyle: {
          borderRadius: [0, 999, 999, 0],
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 1,
            y2: 0,
            colorStops: [
              { offset: 0, color: primary },
              { offset: 1, color: secondary },
            ],
          },
        },
        animationDelay: () => 140,
      },
    ],
  };
}

function EchartsGalleryCard({
  variant,
  title,
  badge,
  description,
  colors,
}: {
  variant: EchartsGalleryVariant;
  title: string;
  badge: string;
  description: string;
  colors: string[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: "svg" });
    chart.setOption(buildEchartsOption(variant, colors));

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => chart.resize()) : null;
    if (observer) observer.observe(ref.current);

    return () => {
      window.removeEventListener("resize", resize);
      observer?.disconnect();
      chart.dispose();
    };
  }, [colors, variant]);

  return (
    <article className={styles.panel} style={{ display: "grid", gap: 12 }}>
      <div className={styles.panelHeader} style={{ marginBottom: 0 }}>
        <h4 style={{ margin: 0, letterSpacing: "-0.03em" }}>{title}</h4>
        <span>{badge}</span>
      </div>
      <div style={{ position: "relative", height: 220 }}>
        <div ref={ref} style={{ width: "100%", height: "100%" }} />
        {variant === "ring" && (
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              pointerEvents: "none",
              color: colors[0] ?? "#35483B",
              fontFamily: "var(--font-inter-tight), var(--font-inter), sans-serif",
              fontSize: 22,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            60 %
          </div>
        )}
      </div>
      <p style={{ margin: 0, fontSize: 11, lineHeight: 1.55, color: "#6b756c" }}>{description}</p>
    </article>
  );
}

function ColorToken({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [copied, setCopied] = useState(false);

  const copyValue = async () => {
    await navigator.clipboard?.writeText(value);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className={styles.colorToken}>
      <label className={styles.colorSwatch} style={{ background: value }} aria-label={`Modifier ${label}`}>
        <input type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} />
      </label>
      <div className={styles.colorInfo}>
        <span>{label}</span>
        <button type="button" onClick={copyValue} className={styles.hexButton}>
          {value} {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
    </div>
  );
}

function SectionTitle({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className={styles.sectionTitle}>
      <span>{eyebrow}</span>
      <h2 style={{ letterSpacing: "-0.025em" }}>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

export default function DesignSystemPage() {
  const [palette, setPalette] = useState(initialPalette);
  const [selectedTab, setSelectedTab] = useState("Aperçu");
  const [isFavorite, setIsFavorite] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [range, setRange] = useState(62);
  const [toast, setToast] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [formAttendancePresent, setFormAttendancePresent] = useState(true);
  const [activityAttendancePresent, setActivityAttendancePresent] = useState(false);
  const [playerTablePage, setPlayerTablePage] = useState(1);
  const [sessionTablePage, setSessionTablePage] = useState(1);
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerStatus, setPlayerStatus] = useState("Tous");
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);
  const [componentLoading, setComponentLoading] = useState(false);
  const [selectedDocumentName, setSelectedDocumentName] = useState("");
  const headerNotificationCount = 3;

  const playerTableRows = [
    { nom: "Leroux", prenom: "Mathilde", handicap: "8.4", statut: "Présent", groupe: "A" },
    { nom: "Mercier", prenom: "Sacha", handicap: "11.2", statut: "Absent", groupe: "A" },
    { nom: "Dubois", prenom: "Julien", handicap: "6.8", statut: "Présent", groupe: "B" },
    { nom: "Martin", prenom: "Nina", handicap: "13.1", statut: "Présent", groupe: "B" },
    { nom: "Favre", prenom: "Lucas", handicap: "9.6", statut: "Présent", groupe: "C" },
    { nom: "Perrin", prenom: "Emma", handicap: "10.9", statut: "Absent", groupe: "C" },
    { nom: "Roux", prenom: "Noah", handicap: "7.3", statut: "Présent", groupe: "D" },
    { nom: "Besson", prenom: "Lina", handicap: "12.5", statut: "Présent", groupe: "D" },
  ];
  const sessionTableRows = [
    { date: "20/07", activite: "Stage d’été", lieu: "Golf Club de Sion", presence: "12/16", notes: "OK" },
    { date: "22/07", activite: "Petit jeu", lieu: "Practice", presence: "10/14", notes: "À confirmer" },
    { date: "24/07", activite: "Parcours", lieu: "Sion", presence: "14/16", notes: "Complet" },
    { date: "26/07", activite: "Putting", lieu: "Green Academy", presence: "11/12", notes: "OK" },
    { date: "28/07", activite: "Approches", lieu: "Golf Club de Sion", presence: "13/15", notes: "À suivre" },
    { date: "30/07", activite: "Préparation", lieu: "Practice", presence: "9/10", notes: "Validé" },
  ];
  const playerTablePageSize = 4;
  const sessionTablePageSize = 3;
  const sessionTableTotalPages = Math.max(1, Math.ceil(sessionTableRows.length / sessionTablePageSize));
  const filteredPlayerRows = playerTableRows.filter((row) => {
    const searchable = `${row.nom} ${row.prenom} ${row.groupe}`.toLowerCase();
    return searchable.includes(playerQuery.toLowerCase()) && (playerStatus === "Tous" || row.statut === playerStatus);
  });
  const filteredPlayerTotalPages = Math.max(1, Math.ceil(filteredPlayerRows.length / playerTablePageSize));
  const visiblePlayerRows = filteredPlayerRows.slice((playerTablePage - 1) * playerTablePageSize, playerTablePage * playerTablePageSize);
  const visibleSessionRows = sessionTableRows.slice((sessionTablePage - 1) * sessionTablePageSize, sessionTablePage * sessionTablePageSize);

  const cssVariables = useMemo(
    () =>
      ({
        "--ds-primary": palette.primary,
        "--ds-primary-rgb": hexToRgb(palette.primary),
        "--ds-secondary": palette.secondary,
        "--ds-secondary-rgb": hexToRgb(palette.secondary),
        "--ds-accent": palette.accent,
        "--ds-accent-rgb": hexToRgb(palette.accent),
      }) as React.CSSProperties,
    [palette],
  );

  const updateColor = (key: PaletteKey, value: string) => setPalette((current) => ({ ...current, [key]: value }));
  const closeDrawer = () => setDrawerOpen(false);
  const fieldTextStyle = {
    fontFamily: "var(--font-inter), sans-serif",
    fontSize: "12px",
    fontWeight: 500,
    lineHeight: 1.2,
    letterSpacing: "0.01em",
  } as const;
  const fieldShellStyle = {
    position: "relative",
    width: "100%",
  } as const;
  const fieldIconStyle = {
    position: "absolute",
    left: 11,
    top: "50%",
    transform: "translateY(-50%)",
    color: "#7c877d",
    pointerEvents: "none",
  } as const;
  const fieldInputWithIconStyle = {
    ...fieldTextStyle,
    paddingLeft: 34,
  } as const;

  return (
    <main data-design-system className={styles.page} style={{ ...cssVariables, gridTemplateColumns: "1fr" }}>
      <header
        className={styles.designSystemHeader}
        style={{
          gridColumn: "1 / -1",
          margin: "0 0 16px",
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          background: "var(--ds-primary)",
          backdropFilter: "blur(16px)",
          boxShadow: "0 10px 30px rgba(27,45,33,.18)",
        }}
      >
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Ouvrir le drawer"
          style={{
            justifySelf: "start",
            width: 28,
            height: 28,
            display: "grid",
            placeItems: "center",
            border: 0,
            borderRadius: 0,
            background: "transparent",
            color: "#fff",
            cursor: "pointer",
            flex: "none",
            padding: 0,
          }}
        >
          <Menu size={24} strokeWidth={2.25} />
        </button>

        <Link href="#top" aria-label="ActiviTee - Design system" style={{ display: "inline-flex", alignItems: "center", justifySelf: "center" }}>
          <span className="brand" style={{ color: "#fff", textShadow: "none" }}>
            <span className="brand-nex" style={{ color: "#fff" }}>Activi</span>
            <span className="brand-tee" style={{ color: "rgba(255,255,255,0.9)" }}>Tee</span>
          </span>
        </Link>

        <div style={{ justifySelf: "end" }}>
          <button
            type="button"
            aria-label="Notifications"
            style={{
              width: 30,
              height: 30,
              display: "grid",
              placeItems: "center",
              border: 0,
              borderRadius: 0,
              background: "transparent",
              color: "#fff",
              cursor: "pointer",
              position: "relative",
              padding: 0,
            }}
          >
            <Bell size={20} strokeWidth={2} />
            {headerNotificationCount > 0 ? (
              <span
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  minWidth: 18,
                  height: 18,
                  padding: "0 5px",
                  borderRadius: 999,
                  background: "#d84b43",
                  color: "#fff",
                  fontSize: 10,
                  fontWeight: 900,
                  lineHeight: "18px",
                  textAlign: "center",
                  boxShadow: "0 0 0 2px var(--ds-primary)",
                }}
              >
                {headerNotificationCount > 99 ? "99+" : headerNotificationCount}
              </span>
            ) : null}
          </button>
        </div>
      </header>

      <div className={styles.designSystemScroll}>
      <div className={styles.content} id="top">
        <header className={styles.hero}>
          <div>
            <span className={styles.kicker}>ActiviTee · v1.0</span>
            <h1 style={{ letterSpacing: "-0.03em" }}>Le terrain de jeu<br /><i>de la marque.</i></h1>
            <p>Une bibliothèque d’interface éditable, pensée pour conserver une expérience sportive, chaleureuse et précise sur chaque écran.</p>
          </div>
          <div className={styles.heroActions}>
            <a href="#hero" className={styles.primaryButton}><Sparkles size={17} /> Voir le Hero</a>
            <button type="button" className={styles.iconOnly} aria-label="Réglages"><Settings2 size={19} /></button>
          </div>
        </header>

        <section id="fondations" className={styles.section}>
          <SectionTitle eyebrow="01 / Fondations" title="Couleurs & identité" description="Les tokens essentiels. Modifiez-les pour tester instantanément leur rendu dans les composants." />
          <div className={styles.foundationGrid}>
            <div className={styles.panel}>
              <div className={styles.panelHeader}><h4 style={{ letterSpacing: "-0.03em", margin: 0 }}>Palette de marque</h4><span>Éditable</span></div>
              <div className={styles.paletteGrid}>
                <ColorToken label="Vert forêt / primaire" value={palette.primary} onChange={(value) => updateColor("primary", value)} />
                <ColorToken label="Sauge / secondaire" value={palette.secondary} onChange={(value) => updateColor("secondary", value)} />
                <ColorToken label="Ocre / accent" value={palette.accent} onChange={(value) => updateColor("accent", value)} />
              </div>
              <div className={styles.neutralStrip}>
                {["#111827", "#4B5563", "#9CA3AF", "#E5E7EB", "#F4F6F5", "#FFFFFF"].map((color) => <span key={color} style={{ background: color }} title={color} />)}
              </div>
            </div>
            <div className={`${styles.panel} ${styles.typePanel}`}>
              <div className={styles.panelHeader}><h4 style={{ letterSpacing: "-0.03em", margin: 0 }}>Typographie</h4><span>Inter</span></div>
              <div className={styles.typeRows}>
                <p><b>Inter Tight</b><span>Display · titres</span></p>
                <p><b>Inter</b><span>Interface · texte</span></p>
                <p><b>400 · 500 · 600 · 700</b><span>Graisses disponibles</span></p>
              </div>
            </div>
          </div>
          <article
            className={styles.panel}
            style={{
              marginTop: 16,
              background:
                "linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(246,248,245,0.96) 100%)",
            }}
          >
            <div className={styles.panelHeader}>
              <h4 style={{ letterSpacing: "-0.03em", margin: 0 }}>Hiérarchie des titres</h4>
              <span>H1 → H5</span>
            </div>

            <div
              style={{
                display: "grid",
                gap: 12,
              }}
            >
              {[
                { level: "H1", tag: "h1", text: "Titre principal", size: "clamp(34px, 4vw, 54px)", weight: 700, letterSpacing: "-1px" },
                { level: "H2", tag: "h2", text: "Titre de section", size: "clamp(28px, 3vw, 38px)", weight: 700, letterSpacing: "-0.6px" },
                { level: "H3", tag: "h3", text: "Sous-titre de bloc", size: "clamp(22px, 2.2vw, 28px)", weight: 700, letterSpacing: "-0.3px" },
                { level: "H4", tag: "h4", text: "Titre de carte", size: "18px", weight: 700, letterSpacing: "0px" },
                { level: "H5", tag: "h5", text: "Micro-titre", size: "13px", weight: 800, letterSpacing: "0.4px" },
              ].map((item) => {
                const HeadingTag = item.tag as "h1" | "h2" | "h3" | "h4" | "h5";
                return (
                  <div
                    key={item.level}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "64px 1fr",
                      gap: 16,
                      alignItems: "center",
                      padding: "12px 0",
                      borderTop: "1px solid #e7ebe6",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 48,
                        height: 30,
                        borderRadius: 999,
                        background: "rgba(var(--ds-primary-rgb), 0.08)",
                        color: "var(--ds-primary)",
                        fontSize: 11,
                        fontWeight: 900,
                        letterSpacing: "0.8px",
                      }}
                    >
                      {item.level}
                    </span>
                    <div>
                      <HeadingTag
                        style={{
                          color: "var(--ds-primary)",
                          fontSize: item.size,
                          fontWeight: item.weight,
                          lineHeight: 1.05,
                          letterSpacing: item.letterSpacing,
                          fontFamily: "var(--font-inter-tight), var(--font-inter), sans-serif",
                          margin: 0,
                        }}
                      >
                        {item.text}
                      </HeadingTag>
                      <div style={{ marginTop: 4, color: "#7d8780", fontSize: 11, lineHeight: 1.5 }}>
                        Exemple de style pour les contenus éditables dans ActiviTee.
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </article>

          <article className={`${styles.panel} ${styles.tokenPanel}`}>
            <div className={styles.panelHeader}><h4 style={{ margin: 0 }}>Tokens d’interface</h4><span>Règles partagées</span></div>
            <div className={styles.tokenShowcase}>
              <div>
                <b>Espacements</b>
                <div className={styles.spacingScale}>{[4, 8, 12, 16, 24, 32].map((size) => <span key={size} style={{ width: size * 2 }}><i />{size}</span>)}</div>
              </div>
              <div>
                <b>Rayons</b>
                <div className={styles.radiusScale}><span>8</span><span>12</span><span>16</span><span>999</span></div>
              </div>
              <div>
                <b>Élévation</b>
                <div className={styles.elevationScale}><span>0</span><span>1</span><span>2</span></div>
              </div>
              <div>
                <b>Grille</b>
                <p>4 px de base · 12 colonnes desktop · 4 colonnes mobile</p>
              </div>
            </div>
          </article>
        </section>

        <section id="hero" className={styles.section}>
          <SectionTitle eyebrow="02 / Hero" title="Hero" description="La carte Hero du Player, reprise telle quelle dans le système pour servir de base aux pages d’accueil." />
          <article
            className={styles.panel}
            style={{
              padding: 0,
              overflow: "hidden",
              background: "linear-gradient(135deg, #122017 0%, #17291e 48%, #0f1612 100%)",
              color: "#fff",
              borderColor: "rgba(255,255,255,0.08)",
            }}
          >
            <div style={{ padding: 24 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto minmax(0, 1fr)",
                  alignItems: "center",
                  gap: 22,
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: 102,
                    height: 102,
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 31,
                    fontWeight: 900,
                    letterSpacing: "0.04em",
                    color: "#fff",
                    background: "linear-gradient(135deg, #14532d 0%, #064e3b 100%)",
                    border: "3px solid rgba(255,255,255,.22)",
                    boxShadow: "0 16px 30px rgba(0,0,0,.24)",
                  }}
                >
                  ML
                </div>

                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      color: "#fff",
                      fontFamily: "var(--font-inter-tight), var(--font-inter), sans-serif",
                      fontSize: "clamp(28px, 3vw, 38px)",
                      fontWeight: 700,
                      lineHeight: 1,
                      letterSpacing: "-0.04em",
                    }}
                  >
                    Salut Mathilde 👋
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      color: "var(--ds-secondary)",
                      fontSize: 12,
                      fontWeight: 800,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                    }}
                  >
                    Handicap 8.4 • Junior Competitor
                  </div>
                  <div
                    style={{
                      marginTop: 10,
                      color: "rgba(255,255,255,.74)",
                      fontSize: 14,
                      lineHeight: 1.55,
                    }}
                  >
                    Centre de Performance Valais • Golf Club de Sion
                  </div>
                </div>
              </div>
            </div>
          </article>
        </section>

        <section id="composants" className={styles.section}>
          <SectionTitle eyebrow="03 / Composants" title="Actions & navigation" description="Des actions claires, avec une hiérarchie visible quelle que soit la surface." />
          <div className={styles.componentGrid}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}><h4 style={{ margin: 0 }}>Boutons</h4><span>44 px min.</span></div>
              <div className={styles.buttonStack}>
                <button type="button" className={styles.primaryButton}>Action principale <ArrowRight size={16} /></button>
                <button type="button" className={styles.secondaryButton}>Action secondaire</button>
                <button type="button" className={styles.primaryButton}><Plus size={16} /> Ajouter un élément</button>
                <button type="button" className={styles.dangerButton}>Supprimer</button>
                <button type="button" className={styles.primaryButton} disabled>Action indisponible</button>
              </div>
            </article>
            <article className={styles.panel}>
              <div className={styles.panelHeader}><h4 style={{ margin: 0 }}>Navigation</h4><span>Interactif</span></div>
              <div className={styles.tabs} role="tablist">
                {["Aperçu", "Calendrier", "Membres"].map((tab) => <button type="button" role="tab" aria-selected={selectedTab === tab} key={tab} onClick={() => setSelectedTab(tab)}>{tab}</button>)}
              </div>
              <div className={styles.segmented}><button type="button" className={styles.active}>Semaine</button><button type="button">Mois</button><button type="button">Année</button></div>
              <div className={styles.breadcrumb}><span>Club de Genève</span><ChevronDown size={14} /><b>{selectedTab}</b></div>
              <div className={styles.iconButtons}><button type="button" aria-label="Notifications"><Bell size={18} /><i /></button><button type="button" aria-label="Plus d’options"><MoreHorizontal size={20} /></button><button type="button" className={isFavorite ? styles.favorite : ""} onClick={() => setIsFavorite(!isFavorite)} aria-label="Ajouter aux favoris">★</button></div>
            </article>
          </div>

          <div className={styles.componentGrid} style={{ marginTop: 16 }}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}><h4 style={{ margin: 0 }}>Menus, aides & actions</h4><span>Contextuel</span></div>
              <div className={styles.advancedActions}>
                <div className={styles.menuExample}>
                  <button type="button" className={styles.secondaryButton} onClick={() => setShowMenu((current) => !current)} aria-expanded={showMenu}>
                    Actions <ChevronDown size={15} />
                  </button>
                  {showMenu ? (
                    <div className={styles.actionMenu} role="menu">
                      <button type="button" role="menuitem">Dupliquer l’activité</button>
                      <button type="button" role="menuitem">Partager avec le coach</button>
                      <button type="button" role="menuitem" className={styles.menuDanger}>Archiver</button>
                    </div>
                  ) : null}
                </div>
                <div className={styles.tooltipExample}>
                  <button type="button" className={styles.iconOnly} onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)} onFocus={() => setShowTooltip(true)} onBlur={() => setShowTooltip(false)} aria-describedby="help-tooltip">
                    <Info size={18} />
                  </button>
                  {showTooltip ? <span id="help-tooltip" role="tooltip">Une aide courte, au bon moment.</span> : null}
                </div>
                <button type="button" className={styles.dangerButton} onClick={() => setShowModal(true)}><Trash2 size={15} /> Supprimer</button>
                <button type="button" className={styles.secondaryButton} onClick={() => { setComponentLoading(true); window.setTimeout(() => setComponentLoading(false), 1300); }} disabled={componentLoading}>
                  {componentLoading ? <LoaderCircle size={16} className={styles.spin} /> : <Upload size={16} />} {componentLoading ? "Import en cours" : "État chargé"}
                </button>
              </div>
            </article>
            <article className={styles.panel}>
              <div className={styles.panelHeader}><h4 style={{ margin: 0 }}>Règles d’usage</h4><span>À appliquer</span></div>
              <ul className={styles.usageList}>
                <li><CheckCircle2 size={15} /> Une seule action primaire par zone.</li>
                <li><CheckCircle2 size={15} /> Expliquer les erreurs directement sous le champ.</li>
                <li><CheckCircle2 size={15} /> Réserver le rouge aux actions irréversibles.</li>
                <li><CheckCircle2 size={15} /> Prévoir vide, chargement et erreur pour chaque liste.</li>
              </ul>
            </article>
          </div>

          <article className={`${styles.panel} ${styles.formStatesPanel}`}>
            <div className={styles.panelHeader}><h4 style={{ margin: 0 }}>États de saisie & tags</h4><span>À prévoir</span></div>
            <div className={styles.formStateGrid}>
              <label className={styles.field}>Champ requis<input style={fieldTextStyle} placeholder="Nom du groupe" required /><small className={styles.fieldHelp}>Ce champ est obligatoire.</small></label>
              <label className={styles.field}>Champ validé<input style={{ ...fieldTextStyle, borderColor: "#70a677", background: "#f7fcf6" }} defaultValue="Golf Club de Sion" /><small className={styles.fieldSuccess}><Check size={12} /> Information enregistrée.</small></label>
              <label className={styles.field}>Lecture seule<input style={fieldTextStyle} defaultValue="ID-AT-2026-042" readOnly /></label>
              <label className={styles.field}>Désactivé<select style={fieldTextStyle} disabled defaultValue="Choisir"><option>Choisir</option></select></label>
              <div className={`${styles.field} ${styles.fullField}`}><span>Documents</span><label className={styles.fileUpload}><input type="file" accept=".pdf,.png,.jpg" onChange={(event) => setSelectedDocumentName(event.target.files?.[0]?.name ?? "")} /><span className={styles.fileUploadIcon}><Upload size={18} /></span><span className={styles.fileUploadCopy}><b>{selectedDocumentName || "Ajouter un document"}</b><small>PDF, PNG ou JPG · 10 Mo maximum.</small></span><span className={styles.fileUploadAction}>{selectedDocumentName ? "Remplacer" : "Choisir un fichier"}</span></label></div>
            </div>
            <div className={styles.tagRow} aria-label="Variantes de tags">
              <span>Neutre</span><span className={styles.tagSuccess}>Confirmé</span><span className={styles.tagInfo}>Information</span><span className={styles.tagWarning}>À valider</span><span className={styles.tagError}>Indisponible <button type="button" aria-label="Supprimer le tag">×</button></span>
            </div>
          </article>
        </section>

        <section id="cartes" className={styles.section}>
          <SectionTitle eyebrow="04 / Cartes" title="Cartes" description="Deux variantes pour composer des blocs plus vivants : une carte joueur et une carte activité." />
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            <article className={styles.panel} style={{ display: "grid", gap: 16 }}>
              <div className={styles.panelHeader}>
                <h4 style={{ margin: 0 }}>Carte joueur</h4>
                <span>Player</span>
              </div>
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  padding: 16,
                  borderRadius: 24,
                  background: "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(244,247,243,0.92) 100%)",
                  border: "1px solid #e5ebe4",
                }}
              >
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, alignItems: "center" }}>
                  <div
                    aria-hidden="true"
                    style={{
                      width: 54,
                      height: 54,
                      borderRadius: "50%",
                      display: "grid",
                      placeItems: "center",
                      fontSize: 18,
                      fontWeight: 900,
                      letterSpacing: "0.04em",
                      color: "white",
                      background: "linear-gradient(135deg, #14532d 0%, #064e3b 100%)",
                      boxShadow: "0 10px 22px rgba(15, 90, 52, 0.22)",
                    }}
                  >
                    ML
                  </div>

                  <div style={{ minWidth: 0 }}>
                    <div style={{ marginTop: 4, fontSize: 18, fontWeight: 800, letterSpacing: "-0.03em", color: "#183023" }}>
                      Mathilde Leroux
                    </div>
                  </div>
                </div>
              </div>
            </article>

            <article className={styles.panel} style={{ display: "grid", gap: 16 }}>
              <div className={styles.panelHeader}>
                <h4 style={{ margin: 0 }}>Carte activité</h4>
                <span>Planning</span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "128px minmax(0, 1fr)",
                  borderRadius: 28,
                  overflow: "hidden",
                  background: "linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(247,250,246,1) 100%)",
                  border: "1px solid #e4ebe4",
                  boxShadow: "0 18px 30px rgba(16, 35, 24, 0.08)",
                }}
              >
                <div
                  style={{
                    padding: "14px 12px",
                    borderRight: "1px solid #e2e8e1",
                    display: "grid",
                    alignContent: "center",
                    justifyItems: "center",
                    gap: 10,
                    minHeight: 170,
                    background: "linear-gradient(180deg, rgba(248,251,248,1) 0%, rgba(241,245,240,1) 100%)",
                  }}
                >
                  <div style={{ display: "grid", gap: 4, textAlign: "center" }}>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b776e" }}>
                      Lundi
                    </div>
                    <div style={{ fontSize: 42, lineHeight: 0.95, fontWeight: 900, letterSpacing: "-0.08em", color: "var(--ds-primary)" }}>
                      20
                    </div>
                    <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "0.12em", textTransform: "uppercase", color: "#76817a" }}>
                      Juillet
                    </div>
                    <div style={{ margin: "3px auto 0", width: 26, borderTop: "1px solid #d4dbd1" }} />
                  </div>

                  <div style={{ display: "grid", gap: 4, justifyItems: "center", color: "#5f6d64" }}>
                    <div style={{ fontSize: 12, fontWeight: 700 }}>08:00</div>
                    <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.86 }}>
                      12:00
                    </div>
                  </div>
                </div>

                <div style={{ padding: 18, display: "grid", gap: 18 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "7px 12px",
                        borderRadius: 999,
                        background: "rgba(var(--ds-primary-rgb), 0.08)",
                        color: "var(--ds-primary)",
                        fontSize: 11,
                        fontWeight: 900,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      Stage
                    </span>

                    <AttendanceToggle
                      checked={activityAttendancePresent}
                      onToggle={() => setActivityAttendancePresent((current) => !current)}
                      leftLabel="Absent"
                      rightLabel="Présent"
                      ariaLabel="Basculer la présence à cette activité"
                    />
                  </div>

                  <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                    <h4 style={{ margin: 0, color: "#102017", letterSpacing: "-0.03em", fontSize: 22, lineHeight: 1.05 }}>
                      Stage d’été 2026
                    </h4>
                    <p style={{ margin: 0, color: "#6b776e", fontSize: 13, lineHeight: 1.45 }}>
                      Organisé par Golf Club de Sion
                    </p>
                  </div>

                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#3f5847", fontSize: 13, fontWeight: 800, lineHeight: 1, marginTop: 1 }}>
                      <MapPin size={16} color="#c84a40" style={{ flex: "none" }} />
                      <span>Golf Club de Sion</span>
                    </div>

                    <button
                      type="button"
                      className={styles.secondaryButton}
                      style={{
                        textTransform: "uppercase",
                        lineHeight: 1,
                      }}
                    >
                      Détails
                      <ArrowRight size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          </div>
        </section>

        <section id="tableaux" className={styles.section}>
          <SectionTitle eyebrow="05 / Tableaux" title="Tableaux" description="Des exemples lisibles pour afficher des joueurs, des handicaps et des informations de suivi." />
          <div style={{ display: "grid", gap: 12 }}>
            <article className={styles.panel} style={{ display: "grid", gap: 14 }}>
              <div className={styles.panelHeader} style={{ alignItems: "center", gap: 12 }}>
                <div style={{ display: "grid", gap: 2 }}>
                  <h4 style={{ margin: 0 }}>Joueurs du groupe</h4>
                  <span>Liste</span>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button type="button" className={styles.secondaryButton}>Importer</button>
                  <button type="button" className={styles.primaryButton}><Plus size={16} /> Ajouter un joueur</button>
                </div>
              </div>

              <div className={styles.tableToolbar}>
                <label className={`${styles.field} ${styles.tableSearch}`} style={{ gap: 0 }}>
                  <div style={fieldShellStyle}>
                    <Search size={16} style={fieldIconStyle} aria-hidden="true" />
                    <input
                      style={fieldInputWithIconStyle}
                      value={playerQuery}
                      onChange={(event) => { setPlayerQuery(event.target.value); setPlayerTablePage(1); }}
                      placeholder="Rechercher un joueur"
                      aria-label="Rechercher un joueur"
                    />
                  </div>
                </label>
                <label className={styles.tableFilter}>
                  <Filter size={14} aria-hidden="true" />
                  <select value={playerStatus} onChange={(event) => { setPlayerStatus(event.target.value); setPlayerTablePage(1); }} aria-label="Filtrer par statut">
                    <option>Tous</option>
                    <option>Présent</option>
                    <option>Absent</option>
                  </select>
                </label>
                {selectedPlayers.length > 0 ? (
                  <button type="button" className={styles.tertiaryButton} onClick={() => setSelectedPlayers([])}>
                    <Trash2 size={14} /> Désélectionner {selectedPlayers.length} joueur{selectedPlayers.length > 1 ? "s" : ""}
                  </button>
                ) : null}
              </div>

              <div
                style={{
                  overflow: "hidden",
                  borderRadius: 16,
                  border: "1px solid #e4ebe4",
                  background: "#fff",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f4f7f2" }}>
                      <th style={{ width: 40, padding: "12px 10px", borderBottom: "1px solid #e4ebe4" }}>
                        <input
                          type="checkbox"
                          aria-label="Sélectionner tous les joueurs visibles"
                          checked={visiblePlayerRows.length > 0 && visiblePlayerRows.every((row) => selectedPlayers.includes(`${row.nom}-${row.prenom}`))}
                          onChange={(event) => setSelectedPlayers(event.target.checked ? visiblePlayerRows.map((row) => `${row.nom}-${row.prenom}`) : [])}
                          style={{ accentColor: "var(--ds-primary)" }}
                        />
                      </th>
                      {["Nom", "Prénom", "Handicap", "Statut", "Groupe", "Actions"].map((label) => (
                        <th
                          key={label}
                          style={{
                            padding: "12px 14px",
                            textAlign: "left",
                            fontSize: 11,
                            fontWeight: 900,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "#6d786e",
                            borderBottom: "1px solid #e4ebe4",
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePlayerRows.map((row, index) => (
                      <tr key={`${row.nom}-${row.prenom}`} style={{ background: index % 2 === 0 ? "#fff" : "#fafcf8" }}>
                        <td style={{ padding: "12px 10px", borderBottom: "1px solid #edf1eb" }}>
                          <input
                            type="checkbox"
                            aria-label={`Sélectionner ${row.prenom} ${row.nom}`}
                            checked={selectedPlayers.includes(`${row.nom}-${row.prenom}`)}
                            onChange={(event) => setSelectedPlayers((current) => event.target.checked ? [...current, `${row.nom}-${row.prenom}`] : current.filter((id) => id !== `${row.nom}-${row.prenom}`))}
                            style={{ accentColor: "var(--ds-primary)" }}
                          />
                        </td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb", fontSize: 13, fontWeight: 800, color: "#1c2a21" }}>{row.nom}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb", fontSize: 13, color: "#34463b" }}>{row.prenom}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb", fontSize: 13, fontWeight: 800, color: "var(--ds-primary)" }}>{row.handicap}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "6px 10px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 900,
                              color: row.statut === "Présent" ? "#38694a" : "#a24b43",
                              background: row.statut === "Présent" ? "rgba(56,105,74,0.10)" : "rgba(162,75,67,0.10)",
                            }}
                          >
                            {row.statut}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb", fontSize: 13, color: "#34463b" }}>{row.groupe}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb" }}>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              style={{ height: 32, padding: "0 10px", fontSize: 11, textTransform: "uppercase" }}
                            >
                              Voir
                            </button>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              style={{ height: 32, padding: "0 10px", fontSize: 11, textTransform: "uppercase" }}
                            >
                              Editer
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {visiblePlayerRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: "34px 16px", textAlign: "center", color: "#69756c", fontSize: 13 }}>
                          Aucun joueur ne correspond à cette recherche.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: "#6b756c", fontWeight: 700 }}>
                  {filteredPlayerRows.length ? `${((playerTablePage - 1) * playerTablePageSize) + 1}-${Math.min(playerTablePage * playerTablePageSize, filteredPlayerRows.length)} sur ${filteredPlayerRows.length}` : "0 joueur"}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      background: "#f4f7f2",
                      color: "#607064",
                      border: "1px solid #dfe6dd",
                    }}
                    onClick={() => setPlayerTablePage((current) => Math.max(1, current - 1))}
                    disabled={playerTablePage === 1}
                  >
                    Précédent
                  </button>
                  {Array.from({ length: filteredPlayerTotalPages }, (_, index) => index + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setPlayerTablePage(page)}
                      style={{
                        minWidth: 38,
                        height: 34,
                        padding: "0 12px",
                        background: page === playerTablePage ? "rgba(137,157,125,0.18)" : "#f6f8f5",
                        color: page === playerTablePage ? "var(--ds-primary)" : "#637066",
                        border: page === playerTablePage ? "1px solid rgba(137,157,125,0.28)" : "1px solid #dfe6dd",
                        boxShadow: "none",
                      }}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      background: "#f4f7f2",
                      color: "#607064",
                      border: "1px solid #dfe6dd",
                    }}
                    onClick={() => setPlayerTablePage((current) => Math.min(filteredPlayerTotalPages, current + 1))}
                    disabled={playerTablePage === filteredPlayerTotalPages}
                  >
                    Suivant
                  </button>
                </div>
              </div>

            </article>

            <article className={styles.panel} style={{ display: "grid", gap: 14 }}>
              <div className={styles.panelHeader} style={{ alignItems: "center", gap: 12 }}>
                <div style={{ display: "grid", gap: 2 }}>
                  <h4 style={{ margin: 0 }}>Suivi des séances</h4>
                  <span>Tableau récap</span>
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <button type="button" className={styles.secondaryButton}>Exporter</button>
                  <button type="button" className={styles.primaryButton}><Plus size={16} /> Ajouter une activité</button>
                </div>
              </div>

              <div
                style={{
                  overflow: "hidden",
                  borderRadius: 16,
                  border: "1px solid #e4ebe4",
                  background: "#fff",
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f4f7f2" }}>
                      {["Date", "Activité", "Lieu", "Présence", "Notes", "Actions"].map((label) => (
                        <th
                          key={label}
                          style={{
                            padding: "12px 14px",
                            textAlign: "left",
                            fontSize: 11,
                            fontWeight: 900,
                            letterSpacing: "0.08em",
                            textTransform: "uppercase",
                            color: "#6d786e",
                            borderBottom: "1px solid #e4ebe4",
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSessionRows.map((row, index) => (
                      <tr key={`${row.date}-${row.activite}`} style={{ background: index % 2 === 0 ? "#fff" : "#fafcf8" }}>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb", fontSize: 13, fontWeight: 800, color: "#1c2a21" }}>{row.date}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb", fontSize: 13, color: "#34463b" }}>{row.activite}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb", fontSize: 13, color: "#34463b" }}>{row.lieu}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb", fontSize: 13, fontWeight: 800, color: "var(--ds-primary)" }}>{row.presence}</td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb" }}>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              padding: "6px 10px",
                              borderRadius: 999,
                              fontSize: 11,
                              fontWeight: 900,
                              color: "#355243",
                              background: "rgba(53,82,67,0.10)",
                            }}
                          >
                            {row.notes}
                          </span>
                        </td>
                        <td style={{ padding: "12px 14px", borderBottom: "1px solid #edf1eb" }}>
                          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              style={{ height: 32, padding: "0 10px", fontSize: 11, textTransform: "uppercase" }}
                            >
                              Détails
                            </button>
                            <button
                              type="button"
                              className={styles.secondaryButton}
                              style={{ height: 32, padding: "0 10px", fontSize: 11, textTransform: "uppercase" }}
                            >
                              Modifier
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: "#6b756c", fontWeight: 700 }}>
                  {((sessionTablePage - 1) * sessionTablePageSize) + 1}-{Math.min(sessionTablePage * sessionTablePageSize, sessionTableRows.length)} sur {sessionTableRows.length}
                </div>

                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      background: "#f4f7f2",
                      color: "#607064",
                      border: "1px solid #dfe6dd",
                    }}
                    onClick={() => setSessionTablePage((current) => Math.max(1, current - 1))}
                    disabled={sessionTablePage === 1}
                  >
                    Précédent
                  </button>
                  {Array.from({ length: sessionTableTotalPages }, (_, index) => index + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      className={styles.secondaryButton}
                      onClick={() => setSessionTablePage(page)}
                      style={{
                        minWidth: 38,
                        height: 34,
                        padding: "0 12px",
                        background: page === sessionTablePage ? "rgba(137,157,125,0.18)" : "#f6f8f5",
                        color: page === sessionTablePage ? "var(--ds-primary)" : "#637066",
                        border: page === sessionTablePage ? "1px solid rgba(137,157,125,0.28)" : "1px solid #dfe6dd",
                        boxShadow: "none",
                      }}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    style={{
                      height: 34,
                      padding: "0 12px",
                      background: "#f4f7f2",
                      color: "#607064",
                      border: "1px solid #dfe6dd",
                    }}
                    onClick={() => setSessionTablePage((current) => Math.min(sessionTableTotalPages, current + 1))}
                    disabled={sessionTablePage === sessionTableTotalPages}
                  >
                    Suivant
                  </button>
                </div>
              </div>

            </article>
          </div>
        </section>

        <section id="formulaires" className={styles.section}>
          <SectionTitle eyebrow="06 / Saisie & sélection" title="Saisie & sélection" description="Des champs lisibles, généreux, adaptés aux usages rapides sur le terrain." />
          <div className={styles.formsGrid}>
            <article className={styles.panel}>
              <div className={styles.fieldGrid}>
                <label className={styles.field}>Nom de l’activité<input style={fieldTextStyle} defaultValue="Entraînement putting" /></label>
                <label className={styles.field}>Catégorie<select style={fieldTextStyle} defaultValue="Technique"><option>Technique</option><option>Physique</option><option>Mental</option></select></label>
                <label className={`${styles.field} ${styles.fullField}`}>Recherche<div style={fieldShellStyle}><Search size={16} style={fieldIconStyle} /><input style={fieldInputWithIconStyle} placeholder="Rechercher un joueur…" /></div></label>
                <label className={styles.field}>État de validation<input style={fieldTextStyle} defaultValue="À confirmer" aria-invalid="true" /></label>
                <label className={styles.field}>Mot de passe<input style={fieldTextStyle} type="password" defaultValue="Activitee2026" /></label>
                <label className={styles.field}>Date<input style={fieldTextStyle} type="date" defaultValue="2026-07-20" /></label>
                <label className={styles.field}>Heure<input style={fieldTextStyle} type="time" defaultValue="08:00" /></label>
                <label className={`${styles.field} ${styles.fullField}`}>Paragraphe<textarea style={{ ...fieldTextStyle, minHeight: 102, paddingTop: 12, paddingBottom: 12, resize: "vertical" }} defaultValue="Texte long de démonstration pour les notes, les commentaires ou les descriptions d’activité." /></label>
                <div className={`${styles.fullField}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15 }}>
                  <div className={styles.field} style={{ gap: 10 }}>
                    <span>Statut</span>
                    <div style={{ display: "grid", gap: 10 }}>
                      {["Ouvert", "Planifié", "Archivé"].map((item, index) => (
                        <label key={item} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", color: "#1e2c20", font: "500 12px/1.2 var(--font-inter), sans-serif", letterSpacing: "0.01em", cursor: "pointer" }}>
                          <input type="radio" name="design-system-status" defaultChecked={index === 0} style={{ width: 16, height: 16, accentColor: "var(--ds-primary)", margin: 0 }} />
                          <span>{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className={styles.field} style={{ gap: 10 }}>
                    <span>Options</span>
                    <div style={{ display: "grid", gap: 10 }}>
                      {["Visible par les coachs", "Visible par les parents", "Visible par le joueur"].map((item, index) => (
                        <label key={item} style={{ display: "flex", alignItems: "center", gap: 10, padding: "4px 0", color: "#1e2c20", font: "500 12px/1.2 var(--font-inter), sans-serif", letterSpacing: "0.01em", cursor: "pointer" }}>
                          <input type="checkbox" defaultChecked={index === 0} style={{ width: 16, height: 16, accentColor: "var(--ds-primary)", margin: 0 }} />
                          <span>{item}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </article>
            <article className={styles.panel}>
              <div className={styles.controlList}>
                <div>
                  <div>
                    <b>Notifications d’équipe</b>
                    <small>Recevoir les nouveaux messages</small>
                  </div>
                  <button type="button" className={`${styles.switch} ${notifications ? styles.on : ""}`} onClick={() => setNotifications(!notifications)} aria-pressed={notifications}>
                    <i />
                  </button>
                </div>
                <div>
                  <div>
                    <b>Présence</b>
                    <small>Basculer absent / présent</small>
                  </div>
                  <AttendanceToggle
                    checked={formAttendancePresent}
                    onToggle={() => setFormAttendancePresent((current) => !current)}
                    leftLabel="Absent"
                    rightLabel="Présent"
                    ariaLabel="Basculer présence"
                  />
                </div>
                <div><div><b>Objectif de présence</b><small>{range}% de la saison</small></div><input className={styles.range} type="range" min="0" max="100" value={range} onChange={(event) => setRange(Number(event.target.value))} /></div>
                <div><div><b>Joueurs confirmés</b><small>Choix multiple</small></div><div className={styles.avatars}><span>ML</span><span>SC</span><span>JR</span><button type="button">+4</button></div></div>
              </div>
            </article>
          </div>
        </section>

        <section id="feedback" className={styles.section}>
          <SectionTitle eyebrow="07 / États & messages" title="États & messages" description="Informer sans alourdir : chaque message est identifiable en un coup d’œil." />
          <div className={styles.alertGrid}>
            <div className={`${styles.alert} ${styles.success}`}><Check size={19} /><div><b>Entraînement confirmé</b><p>Les joueurs ont été prévenus.</p></div><button type="button" aria-label="Fermer"><X size={16} /></button></div>
            <div className={`${styles.alert} ${styles.info}`}><Info size={19} /><div><b>Information importante</b><p>Le planning a été mis à jour.</p></div><button type="button" aria-label="Fermer"><X size={16} /></button></div>
            <div className={`${styles.alert} ${styles.warning}`}><CircleAlert size={19} /><div><b>Attention à la météo</b><p>Risque d’orage prévu demain.</p></div><button type="button" aria-label="Fermer"><X size={16} /></button></div>
            <div className={`${styles.alert} ${styles.error}`}><CircleAlert size={19} /><div><b>Action impossible</b><p>Veuillez vérifier les champs.</p></div><button type="button" aria-label="Fermer"><X size={16} /></button></div>
          </div>
          <div className={styles.dataStatesGrid}>
            <article className={styles.dataState}>
              <LoaderCircle size={22} className={styles.spin} />
              <div><b>Chargement</b><p>Les activités sont en cours de récupération.</p></div>
            </article>
            <article className={styles.dataState}>
              <Sparkles size={22} />
              <div><b>Aucune activité</b><p>Créez votre première séance pour commencer.</p><button type="button" className={styles.tertiaryButton}><Plus size={14} /> Ajouter une activité</button></div>
            </article>
            <article className={styles.dataState}>
              <CircleAlert size={22} />
              <div><b>Impossible de charger</b><p>Vérifiez votre connexion puis réessayez.</p><button type="button" className={styles.tertiaryButton}>Réessayer <ChevronRight size={14} /></button></div>
            </article>
          </div>
          {toast && <div className={styles.toast}><Check size={17} /> Modifications enregistrées <button type="button" onClick={() => setToast(false)} aria-label="Fermer"><X size={15} /></button></div>}
          {showModal ? (
            <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => setShowModal(false)}>
              <section className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="delete-title" onMouseDown={(event) => event.stopPropagation()}>
                <button type="button" className={styles.modalClose} onClick={() => setShowModal(false)} aria-label="Fermer"><X size={18} /></button>
                <div className={styles.modalIcon}><Trash2 size={20} /></div>
                <h3 id="delete-title">Supprimer cette activité ?</h3>
                <p>Cette action est irréversible. Les présences et notes associées seront retirées.</p>
                <div><button type="button" className={styles.secondaryButton} onClick={() => setShowModal(false)}>Annuler</button><button type="button" className={styles.dangerButton} onClick={() => setShowModal(false)}>Supprimer</button></div>
              </section>
            </div>
          ) : null}
        </section>

        <section id="echarts" className={styles.section}>
          <SectionTitle eyebrow="08 / Galerie ECharts" title="Galerie ECharts" description="Des variantes propres pour comparer les graphes les plus utiles dans ActiviTee." />
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <EchartsGalleryCard
              variant="line"
              title="Graphe en ligne"
              badge="Présence"
              description="Une lecture nette de l’évolution dans le temps, avec une ligne tendue et sobre."
              colors={[palette.primary, palette.secondary, palette.accent]}
            />
            <EchartsGalleryCard
              variant="curve"
              title="Graphe en courbe"
              badge="Tendance"
              description="La même base, mais avec une courbe plus douce pour des lectures plus organiques."
              colors={[palette.primary, palette.secondary, palette.accent]}
            />
            <EchartsGalleryCard
              variant="bars"
              title="Graphes AB"
              badge="Barres"
              description="Des barres verticales plus propres, avec un fond discret qui laisse respirer la lecture."
              colors={[palette.primary, palette.secondary, palette.accent]}
            />
            <EchartsGalleryCard
              variant="horizontalBars"
              title="Barres horizontales"
              badge="Comparaison"
              description="Idéal pour comparer des catégories avec des libellés plus longs et une lecture latérale."
              colors={[palette.primary, palette.secondary, palette.accent]}
            />
            <EchartsGalleryCard
              variant="progress"
              title="Progression 60%"
              badge="100% / 60%"
              description="Une base de 100% et une partie remplie à 60% pour montrer un objectif ou un avancement."
              colors={[palette.primary, palette.secondary, palette.accent]}
            />
            <EchartsGalleryCard
              variant="ring"
              title="Progression ronde"
              badge="Anneau"
              description="Un anneau de progression rond avec le pourcentage affiché au centre."
              colors={[palette.primary, palette.secondary, palette.accent]}
            />
          </div>
          <div className={styles.chartGuidance}>
            <div><b>Légende & unité</b><span><i style={{ background: "var(--ds-primary)" }} /> Présence (%)</span><span><i style={{ background: "var(--ds-secondary)" }} /> Objectif (%)</span></div>
            <div><b>État sans donnée</b><p>Affichez un message clair et une action de saisie plutôt qu’un graphique vide.</p></div>
            <div><b>Lecture accessible</b><p>Prévoir la valeur, l’unité et l’évolution dans le texte qui accompagne chaque graphe.</p></div>
          </div>
        </section>

        <footer className={styles.footer}>ActiviTee Design System <span>·</span> Ajustez les tokens pour explorer</footer>
      </div>
      </div>

      {drawerOpen ? (
        <>
          <button
            type="button"
            className="drawer-overlay"
            aria-label="Fermer le drawer"
            onClick={closeDrawer}
          />

          <aside className={`drawer-panel drawer-panel--left ${styles.designDrawer}`} aria-label="Navigation du design system">
            <div className="drawer-top">
              <Link href="#top" className="drawer-brand" onClick={closeDrawer} aria-label="ActiviTee">
                <span className="drawer-brand-nex">Activi</span>
                <span className="drawer-brand-tee">Tee</span>
              </Link>

              <button className="icon-btn drawer-close" type="button" onClick={closeDrawer} aria-label="Fermer le drawer">
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            <nav className={styles.designDrawerNav}>
              {[
                {
                  title: "Fondations",
                  items: [
                    { label: "Couleurs & identité", href: "#fondations", icon: Sparkles, active: true },
                    { label: "Hero", href: "#hero", icon: Sparkles },
                    { label: "Actions & navigation", href: "#composants", icon: Menu },
                  ],
                },
                {
                  title: "Bibliothèque",
                  items: [
                    { label: "Cartes", href: "#cartes", icon: Map },
                    { label: "Tableaux", href: "#tableaux", icon: ClipboardList },
                    { label: "Saisie & sélection", href: "#formulaires", icon: Settings2 },
                    { label: "États & messages", href: "#feedback", icon: Info },
                  ],
                },
                {
                  title: "Données & graphiques",
                  items: [
                    { label: "Galerie ECharts", href: "#echarts", icon: BarChart3 },
                  ],
                },
              ].map((group) => (
                <section className={styles.designDrawerSection} key={group.title} aria-label={group.title}>
                  <h2>{group.title}</h2>
                  <div>
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      return (
                        <a key={item.label} href={item.href} className={`${styles.designDrawerItem} ${item.active ? styles.designDrawerItemActive : ""}`} onClick={closeDrawer}>
                          <span><Icon size={24} strokeWidth={2.1} /><b>{item.label}</b></span>
                          <ChevronRight size={23} strokeWidth={2.2} aria-hidden="true" />
                        </a>
                      );
                    })}
                  </div>
                </section>
              ))}
            </nav>
          </aside>
        </>
      ) : null}
    </main>
  );
}
