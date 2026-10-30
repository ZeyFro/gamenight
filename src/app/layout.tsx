import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { after } from "next/server";
import { getOnboardingProgress, missingOnboardingSteps } from "@/lib/onboarding";
import { enqueueOnboardingReminder } from "@/lib/onboarding-reminder";
import { OnboardingPrompt } from "@/components/onboarding/OnboardingPrompt";
import { logger } from "@/lib/logger";
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
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { isSkipLinkEnabled, SKIP_LINK_TARGET_ID } from "@/lib/skip-link";
import { getSeasonalTheme } from "@/lib/seasonal-theme";

// PWA : manifest et méta Apple pour l'installation ; le service worker ne
// garde qu'une page hors-ligne statique, jamais de contenu de compte.
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

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Feature "forcer la reconnexion globale" (PR 75) — `getCurrentUser()`
  // est la seule source de vérité "vraiment connecté" (tient compte de
  // `forceReloginAt`, contrairement à `auth()` seul, cf. commentaire dans
  // `page.tsx`) : BottomNav/GuideFab/confettis ne doivent pas rester
  // affichés par-dessus l'écran de connexion après un déclenchement.
  const user = await getCurrentUser();
  const onboarding = user ? await getOnboardingProgress(user.id) : null;
  if (user && onboarding && missingOnboardingSteps(onboarding).length) {
    after(async () => {
      try { await enqueueOnboardingReminder(user.id); }
      catch (error) { logger.error("onboarding-reminder", error, { userId: user.id }); }
    });
  }
  const skipLink = isSkipLinkEnabled();
  const seasonalTheme = getSeasonalTheme(new Date());

  return (
    <html
      lang="fr"
      className="h-full antialiased"
    >
      <body className={`flex min-h-full flex-col bg-background text-foreground ${user ? "gn-authenticated" : ""} ${seasonalTheme ? `gn-theme-${seasonalTheme}` : ""}`}>
        <MotionConfig reducedMotion="user">
          <ServiceWorkerRegistration />
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
          {user && onboarding && <OnboardingPrompt userId={user.id} progress={onboarding} />}
          {user && <CelebrationConfetti soundEnabled={user.soundEnabled} />}
          <Toaster theme="dark" position="bottom-center" richColors />
          <CursorTrail />
        </MotionConfig>
      </body>
    </html>
  );
}
