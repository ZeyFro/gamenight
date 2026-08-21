import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MotionConfig } from "framer-motion";
import { Toaster } from "sonner";
import { auth } from "@/auth";
import { Header } from "@/components/Header";
import { BottomNav } from "@/components/BottomNav";
import { PageTransition } from "@/components/PageTransition";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GameNight",
  description: "Organise tes soirées jeux avec tes potes.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const session = await auth();

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
          <Toaster theme="dark" position="bottom-center" richColors />
        </MotionConfig>
      </body>
    </html>
  );
}
