import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { TowerChallengeAppealControls, TowerArbiterConfiguration } from "@/components/admin/TowerChallengeAppealControls";
import { getCurrentUser } from "@/lib/current-user";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { prisma } from "@/lib/prisma";
import { getTowerChallengeArbiterConfiguration, getTowerChallengeStaffQueue } from "@/lib/tower-challenges";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modération des défis Tower | GameNight" };

const frDate = (value: Date) => new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris",
}).format(value);

export default async function TowerAppealsPage() {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");
  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) return <main className="mx-auto max-w-4xl px-4 py-8"><Card>Choisis une communauté active pour consulter la modération Tower.</Card></main>;

  const [queue, community] = await Promise.all([
    getTowerChallengeStaffQueue({ communityId, userId: user.id }),
    prisma.community.findUnique({ where: { id: communityId }, select: { name: true, discordGuildId: true } }),
  ]);
  if (queue.status === "FORBIDDEN" || queue.status === "INVALID") notFound();
  if (queue.status !== "STAFF_QUEUE") return <main className="mx-auto max-w-4xl px-4 py-8"><Card>La modération des défis Tower n’est pas accessible dans cette communauté.</Card></main>;

  const configuration = queue.viewerRole === "OWNER" ? await getTowerChallengeArbiterConfiguration({communityId,userId:user.id}) : null;
  const proofUrl = (channelId: string | null, messageId: string | null) => community?.discordGuildId && channelId && messageId
    ? `https://discord.com/channels/${community.discordGuildId}/${channelId}/${messageId}` : null;

  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
    <header>
      <p className="text-sm font-medium uppercase tracking-wide text-accent">{community?.name ?? "Communauté active"}</p>
      <h1 className="mt-1 text-3xl font-bold text-foreground">Modération des défis Tower</h1>
      <p className="mt-2 text-sm text-muted">Les dossiers restent conservés. Une preuve en attente peut être archivée à J+30 sans suppression ni récompense automatique.</p>
    </header>

    {configuration?.status === "ARBITER_CONFIGURATION" && <Card>
      <h2 className="text-xl font-semibold">Configuration de l’arbitre fixe</h2>
      <TowerArbiterConfiguration candidates={configuration.candidates} arbiterUserId={configuration.arbiterUserId} locked={configuration.locked} />
      <h3 className="mt-4 font-semibold">Journal des changements</h3>
      <ul className="text-sm text-muted">{configuration.history.map((entry,index)=><li key={index}>{frDate(entry.createdAt)} · {entry.previousArbiterUserId ?? "Non configuré"} → {entry.arbiterUserId} · par {entry.changedByUserId}</li>)}</ul>
    </Card>}
    {queue.isStaff && <section className="flex flex-col gap-3" aria-labelledby="tower-pending-title">
      <h2 id="tower-pending-title" className="text-xl font-semibold text-foreground">Preuves signalées à l’équipe</h2>
      {queue.proofs.length ? queue.proofs.map(proof => {
        const url = proofUrl(proof.proofChannelId, proof.proofMessageId);
        return <Card key={proof.id} className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-foreground">{proof.title}{proof.teamName ? ` · ${proof.teamName}` : ` · ${proof.discordName}`}</h3>
            <span className="text-xs text-muted">Signalée le {frDate(proof.staffReportedAt)}</span>
          </div>
          <p className="whitespace-pre-wrap text-sm text-muted">{proof.proofText}</p>
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-sm text-accent underline">Ouvrir la preuve dans Discord</a>}
          <p className="text-xs text-muted">Soumise le {frDate(proof.submittedAt)}{proof.archivedAt ? ` · Archivée le ${frDate(proof.archivedAt)}` : " · En attente de décision"}. Aucun étage n’est attribué par ce signalement ou par l’archivage.</p>
        </Card>;
      }) : <Card><p className="text-sm text-muted">Aucune preuve sans quorum signalée à l’équipe.</p></Card>}
    </section>}

    <section className="flex flex-col gap-3" aria-labelledby="tower-appeals-title">
      <h2 id="tower-appeals-title" className="text-xl font-semibold text-foreground">Contestations ouvertes</h2>
      {queue.appeals.length ? queue.appeals.map(appeal => {
        const url = proofUrl(appeal.proofChannelId, appeal.proofMessageId);
        const conflict = appeal.arbiterUserId !== null || ["ADMIN", "OWNER"].includes(appeal.authorRole);
        const canDecide = conflict
          ? queue.viewerRole === "MEMBER" && appeal.arbiterUserId === user.id
          : queue.isStaff && appeal.authorUserId !== user.id;
        return <Card key={appeal.id} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-foreground">{appeal.title} · {appeal.authorName}</h3>
            <span className="text-xs text-muted">À traiter avant le {frDate(appeal.dueAt)}</span>
          </div>
          <div className="rounded-lg bg-surface-hover p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">Motif de contestation</p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{appeal.reason}</p>
          </div>
          {appeal.proofText && <p className="whitespace-pre-wrap text-sm text-muted">Preuve initiale : {appeal.proofText}</p>}
          {url && <a href={url} target="_blank" rel="noreferrer" className="text-sm text-accent underline">Ouvrir la preuve dans Discord</a>}
          {conflict && appeal.arbiterUserId && <p className="text-sm text-muted">Arbitre indépendant désigné. Seul cet arbitre peut statuer sur ce dossier.</p>}
          {conflict && !appeal.arbiterUserId && queue.viewerRole !== "OWNER" && <p className="text-sm text-muted">Ce dossier ne peut pas être réaffecté : l’arbitre doit avoir été configuré au préalable.</p>}
          <TowerChallengeAppealControls
            appealId={appeal.id}
            canDecide={canDecide}
          />
        </Card>;
      }) : <Card><p className="text-sm text-muted">Aucune contestation ouverte à traiter pour ton rôle.</p></Card>}
    </section>
  </main>;
}
