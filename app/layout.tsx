import "./globals.css";
import type { ReactNode } from "react";
import { Inter, Inter_Tight } from "next/font/google";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr" className={`${inter.className} ${inter.variable} ${interTight.variable}`}>
      <body>{children}</body>
    </html>
  );
}
