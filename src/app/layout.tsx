import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { auth } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { GuideFab } from "@/components/GuideFab";
import { CelebrationConfetti } from "@/components/CelebrationConfetti";
import { PageTransition } from "@/components/PageTransition";
import { CursorTrail } from "@/components/CursorTrail";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// PWA basique (Sprint 2, U7) : manifest + meta Apple pour permettre
// l'ajout à l'écran d'accueil (icône seule, sans barre de navigateur) —
// volontairement PAS de service worker (pas de cache offline, pas de
// push), juste ce qu'il faut pour l'installation.
export const metadata: Metadata = {
  title: "GameNight",
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
  const session = await auth();
  const user = session?.user ? await getCurrentUser() : null;

  return (
    <html
      lang="fr"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-background text-foreground">
        <MotionConfig reducedMotion="user">
          <Header />
          <main className={`flex flex-1 flex-col ${session?.user ? "pb-16 sm:pb-0" : ""}`}>
            <PageTransition>{children}</PageTransition>
          </main>
          {session?.user && <BottomNav />}
          {session?.user && <GuideFab />}
          {session?.user && <CelebrationConfetti soundEnabled={user?.soundEnabled ?? true} />}
          <Toaster theme="dark" position="bottom-center" richColors />
          <CursorTrail />
        </MotionConfig>
      </body>
    </html>
  );
}
