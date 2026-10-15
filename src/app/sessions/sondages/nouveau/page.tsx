import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { requireCommunityChosen } from "@/lib/community-picker";
import { creationMemberUserWhere } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { todayDateOnly, toDateInputValue } from "@/lib/wallclock";
import { AvailabilityPollForm } from "@/components/sessions/AvailabilityPollForm";
import type { NotifyRecipientCandidate } from "@/components/NotifyRecipientsField";
import { Card } from "@/components/ui/Card";
import Link from "next/link";

const errors: Record<string, string> = {
  authentication: "Reconnecte-toi pour créer un sondage.",
  rate_limited: "Trop de créations rapprochées. Réessaie dans quelques secondes.",
  invalid: "Vérifie le titre, les participants et les créneaux futurs (90 jours maximum).",
};

export default async function NewAvailabilityPollPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  await requireCommunityChosen(user.id, "/sessions/sondages/nouveau");
  const [rows, params] = await Promise.all([
    prisma.user.findMany({ where: { AND: [{ id: { not: user.id } }, await creationMemberUserWhere(user.id)] }, select: { id: true, discordName: true, discordAvatar: true, color: true }, orderBy: { discordName: "asc" }, take: 99 }),
    searchParams,
  ]);
  const participants: NotifyRecipientCandidate[] = rows.map(row => ({ ...row, tagIds: [] }));
  return <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
    <header><h1 className="text-2xl font-bold">Nouveau sondage de créneaux</h1><p className="text-sm text-muted">Choisissez des personnes et des horaires possibles. Aucune soirée n’existe avant votre décision finale.</p></header>
    {params.error && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{errors[params.error] ?? errors.invalid}</p>}
    <Card><AvailabilityPollForm participants={participants} minDate={toDateInputValue(todayDateOnly())} /></Card>
    <Link href="/sessions/sondages" className="text-sm text-accent hover:underline">← Tous les sondages</Link>
  </main>;
}
