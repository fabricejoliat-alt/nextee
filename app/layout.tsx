import "./globals.css";
import type { ReactNode } from "react";
import { Suspense } from "react";
import type { Metadata } from "next";
import { IBM_Plex_Sans, Inter, Inter_Tight } from "next/font/google";
import RouteLoadingIndicator from "@/components/ui/RouteLoadingIndicator";
import AuthSessionBoundary from "@/components/auth/AuthSessionBoundary";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter-tight",
});

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-ibm-plex-sans",
  weight: ["400", "500", "600", "700"],
});

/**
 * Empêche le zoom/dézoom sur mobile (Safari/Chrome) et en PWA ("Ajouter à l'écran")
 * + viewport-fit=cover pour les iPhones avec encoche
 */
export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    shortcut: ["/icon-192.png"],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="fr"
      className={`${inter.className} ${inter.variable} ${interTight.variable} ${ibmPlexSans.variable}`}
    >
      <body>
        <Suspense fallback={null}>
          <AuthSessionBoundary />
          <RouteLoadingIndicator />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
