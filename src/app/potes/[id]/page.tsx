import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { todayDateOnly } from "@/lib/wallclock";
import { AvailabilityView } from "@/components/AvailabilityView";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Profil d'un pote");

const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

/** Onglet "Dispos" (route par défaut) — voir `layout.tsx` pour l'en-tête. */
export default async function PoteDisposPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id } = await params;

  const today = todayDateOnly();
  const [weeklySlots, overrides] = await Promise.all([
    prisma.weeklyAvailability.findMany({
      where: { userId: id },
      orderBy: [{ dayOfWeek: "asc" }, { startTime: "asc" }],
    }),
    prisma.availabilityOverride.findMany({
      where: {
        userId: id,
        date: { gte: today, lte: new Date(today.getTime() + FOURTEEN_DAYS_MS) },
      },
      orderBy: { date: "asc" },
    }),
  ]);

  return <AvailabilityView weeklySlots={weeklySlots} overrides={overrides} />;
}
