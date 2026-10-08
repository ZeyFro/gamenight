import type { Metadata, Viewport } from "next";
import { DM_Sans, Space_Grotesk, Geist_Mono } from "next/font/google";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { getCurrentUser } from "@/lib/current-user";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { GuideFab } from "@/components/GuideFab";
import { CelebrationConfetti } from "@/components/CelebrationConfetti";
import { PageTransition } from "@/components/PageTransition";
import { CursorTrail } from "@/components/CursorTrail";
import { MotionBackground } from "@/components/app/MotionBackground";
import "./globals.css";
import { SkipLink } from "@/components/SkipLink";
import { isSkipLinkEnabled, SKIP_LINK_TARGET_ID } from "@/lib/skip-link";

const geistSans = DM_Sans({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const display = Space_Grotesk({ variable: "--font-display", subsets: ["latin"] });

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// PWA basique (Sprint 2, U7) : manifest + meta Apple pour permettre
// l'ajout à l'écran d'accueil (icône seule, sans barre de navigateur) —
// volontairement PAS de service worker (pas de cache offline, pas de
// push), juste ce qu'il faut pour l'installation.
export const metadata: Metadata = {
  title: { default: "GameNight", template: "%s · GameNight" },
  description: "Organise tes soirées jeux avec tes potes.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "GameNight",
  },
  icons: {
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#8b5cf6",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Feature "forcer la reconnexion globale" (PR 75) — `getCurrentUser()`
  // est la seule source de vérité "vraiment connecté" (tient compte de
  // `forceReloginAt`, contrairement à `auth()` seul, cf. commentaire dans
  // `page.tsx`) : BottomNav/GuideFab/confettis ne doivent pas rester
  // affichés par-dessus l'écran de connexion après un déclenchement.
  const user = await getCurrentUser();
  const skipLink = isSkipLinkEnabled();

  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className={`flex min-h-full flex-col bg-background text-foreground ${user ? "gn-authenticated" : ""}`}>
        <MotionConfig reducedMotion="user">
          <MotionBackground />
          {skipLink && <SkipLink />}
          <Header />
          <main
            id={skipLink ? SKIP_LINK_TARGET_ID : undefined}
            tabIndex={skipLink ? -1 : undefined}
            className={`gn-main flex flex-1 flex-col ${skipLink ? "focus:outline-none " : ""}${user ? "pb-16 lg:pb-0" : ""}`}
          >
            <PageTransition>{children}</PageTransition>
          </main>
          {user && <BottomNav />}
          {user && <GuideFab />}
          {user && <CelebrationConfetti soundEnabled={user.soundEnabled} />}
          <Toaster theme="dark" position="bottom-center" richColors />
          <CursorTrail />
        </MotionConfig>
      </body>
    </html>
  );
}
