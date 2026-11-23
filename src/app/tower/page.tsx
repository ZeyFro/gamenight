import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { getMemberStats } from "@/lib/member-stats";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getTowerChallengeAppealableAttempts, getTowerChallengeState, getTowerSeasonLeaderboard, getTowerTeamDailyStates } from "@/lib/tower-challenges";
import { getTowerSchoolSeason } from "@/lib/tower-challenge-seasons";
import { levelProgress, rankForLevel, xpLevelLabel } from "@/lib/xp";
import { prisma } from "@/lib/prisma";
import { pageMetadata } from "@/lib/page-title";
import { getTowerReplacementOffer } from "@/lib/tower-challenge-replacement";
import { replaceTowerChallengeAction } from "./actions";
import { TowerChallengeAppealForm } from "@/components/tower/TowerChallengeAppealForm";
import { isTowerChallengeAppealWindowOpen } from "@/lib/tower-challenge-appeal-rules";
import { TOWER_FLOORS_RESET_NOTICE, isLaunchTextsEnabled } from "@/lib/launch-texts";
import { towerChallengeCategoryLabel, towerProofRuleNotice } from "@/lib/tower-challenge-categories";

export const metadata = pageMetadata("The Tower");

const challengeStatus: Record<string, string> = {
  ASSIGNED: "À réaliser", SUBMITTED: "En vote", APPROVED: "Réussi", REJECTED: "Refusé",
};

const replacementResult: Record<string, string> = {
  REPLACED: "Défi remplacé par un défi équivalent. Ton quota et ton échéance ne changent pas.",
  NO_EQUIVALENT: "Aucun défi équivalent n’est disponible pour le moment.",
  BLOCKED: "Ce défi ne peut pas être remplacé (déjà remplacé, plus à réaliser ou jeu possédé).",
  NOT_FOUND: "Défi introuvable.", RATE: "Trop de demandes, réessaie dans une minute.",
};

export default async function TowerPage({ searchParams }: { searchParams: Promise<{ remplacement?: string }> }) {
  const { remplacement } = await searchParams;
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");

  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) {
    return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-semibold text-foreground">The Tower</h1>
      <Card><p className="text-muted">Choisis une communauté active pour voir tes défis et ton classement.</p></Card>
    </main>;
  }

  const [community, membership, stats, challenges, leaderboard, teamStates, appealable, replacementOffer] = await Promise.all([
    prisma.community.findUnique({ where: { id: communityId }, select: {
      name: true, towerLevelsPerFloor: true, towerChallengesEnabled: true, communityTeamsEnabled: true, discordGuildId: true,
    } }),
    prisma.membership.findUnique({ where: { communityId_userId: { communityId, userId: user.id } }, select: { status: true, role: true } }),
    getMemberStats(user.id, communityId),
    getTowerChallengeState({ communityId, userId: user.id }),
    getTowerSeasonLeaderboard({ communityId, userId: user.id }),
    getTowerTeamDailyStates({ communityId, userId: user.id }),
    getTowerChallengeAppealableAttempts({ communityId, userId: user.id }),
    getTowerReplacementOffer({ communityId, userId: user.id }),
  ]);
  const ascension = levelProgress(stats?.xpTotal ?? 0);
  const season = leaderboard.status === "LEADERBOARD" ? leaderboard.season : getTowerSchoolSeason();
  const currentChallenge = challenges.status === "STATE"
    ? challenges.attempts.find(attempt => attempt.status === "ASSIGNED" || attempt.status === "SUBMITTED")
    : null;
  const appealableAttempts = appealable.status === "APPEALABLE_ATTEMPTS"
    ? appealable.attempts.filter(attempt => isTowerChallengeAppealWindowOpen(attempt.announcedAt, new Date()))
    : [];
  const names = leaderboard.status === "LEADERBOARD" && leaderboard.entries.length
    ? await prisma.user.findMany({ where: { discordId: { in: leaderboard.entries.map(entry => entry.discordId) } }, select: { discordId: true, discordName: true } })
    : [];
  const nameByDiscordId = new Map(names.map(member => [member.discordId, member.discordName]));
  const discordChannel = community?.discordGuildId && process.env.TOWER_DISCORD_CHANNEL_ID
    ? `https://discord.com/channels/${community.discordGuildId}/${process.env.TOWER_DISCORD_CHANNEL_ID}` : null;

  return <main className="mx-auto flex w-full max-w-5xl flex-col gap-7 px-4 py-8 sm:px-6 sm:py-12">
    <header className="rounded-3xl border border-accent/30 bg-gradient-to-br from-accent/15 via-surface to-surface p-6 sm:p-9">
      <p className="text-sm font-medium uppercase tracking-[0.18em] text-accent">GameNight · {community?.name ?? "Communauté"}</p>
      <h1 className="mt-2 text-4xl font-bold text-foreground">The Tower</h1>
      <p className="mt-3 max-w-2xl text-muted">Défis solo et d’équipe, étages personnels, saisons et classement réunis au même endroit.</p>
      {discordChannel && <Link href={discordChannel} target="_blank" rel="noreferrer" className="mt-5 inline-flex rounded-xl bg-accent px-4 py-2 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
        Ouvrir les défis sur Discord ↗
      </Link>}
      {membership?.status === "ACTIVE" && (membership.role === "ADMIN" || membership.role === "OWNER")
        && <Link href="/admin/tower-appeals" className="mt-3 inline-flex rounded-xl border border-border px-4 py-2 text-sm font-semibold text-foreground hover:bg-surface-hover">Ouvrir la file de modération</Link>}
      {process.env.TOWER_CHALLENGE_PROPOSALS_ENABLED === "true" && <div className="mt-3 flex flex-wrap gap-3 text-sm">
        <Link href="/tower/propositions" className="font-medium text-accent underline-offset-4 hover:underline">Proposer un défi (Ranker et plus)</Link>
        {membership?.status === "ACTIVE" && (membership.role === "ADMIN" || membership.role === "OWNER")
          && <Link href="/admin/tower-propositions" className="font-medium text-accent underline-offset-4 hover:underline">Valider les propositions</Link>}
      </div>}
    </header>

    <section className="grid gap-4 md:grid-cols-2" aria-label="Progression personnelle">
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Ascension · XP GameNight</p>
        <h2 className="text-2xl font-semibold text-foreground">{xpLevelLabel(ascension.level)}</h2>
        <p className="text-sm text-muted">Rang {rankForLevel(ascension.level).name} · {Math.floor(ascension.fraction * 100)} % vers le niveau d’XP {ascension.level + 1} ({ascension.earned.toLocaleString("fr-FR")} / {ascension.needed.toLocaleString("fr-FR")} XP)</p>
        <Link href="/ascension" className="text-sm font-medium text-accent underline-offset-4 hover:underline">Voir le détail de l’ascension →</Link>
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Étages remportés par les défis</p>
        <h2 className="text-2xl font-semibold text-foreground">Étage {challenges.status === "STATE" ? challenges.floor : "1"}</h2>
        <p className="text-sm text-muted">Ce compteur alimente le classement Tower. Il reste distinct de l’ascension XP afin de ne pas compter deux fois une réussite.</p>
      </Card>
      {isLaunchTextsEnabled() && <p className="text-xs text-muted md:col-span-2">{TOWER_FLOORS_RESET_NOTICE}</p>}
    </section>

    {remplacement && replacementResult[remplacement] ? <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-foreground">{replacementResult[remplacement]}</p> : null}

    <section className="grid gap-4 lg:grid-cols-2" aria-label="Défis en cours">
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Défi solo</p>
        {currentChallenge ? <>
          <h2 className="text-xl font-semibold text-foreground">{currentChallenge.title}</h2>
          <p className="text-sm text-muted">{challengeStatus[currentChallenge.status] ?? currentChallenge.status} · +{currentChallenge.rewardFloors} étage(s) personnels</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{currentChallenge.instructions}</p>
          <p className="text-xs font-medium text-foreground" data-proof-rule={currentChallenge.allowsPastProof ? "ancienne" : "posterieure"}>
            {towerChallengeCategoryLabel(currentChallenge.category) ? `${towerChallengeCategoryLabel(currentChallenge.category)} · ` : ""}{towerProofRuleNotice(currentChallenge.allowsPastProof)}
          </p>
          {currentChallenge.proofCode && !currentChallenge.allowsPastProof && <div className="rounded-lg bg-surface-hover p-3">
            <p className="text-sm font-semibold text-foreground">Code de preuve : <code>{currentChallenge.proofCode}</code></p>
            <p className="mt-1 text-xs text-muted">Inscris-le dans le jeu si possible. Sinon, ajoute-le à la composition GameNight qui accompagne la capture. Il associe les éléments de preuve, mais ne prouve pas la date de la capture.</p>
          </div>}
          <p className="text-xs text-muted">Échéance : {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(currentChallenge.expiresAt)} (Paris)</p>
          {replacementOffer.status === "OFFER" && replacementOffer.attemptId === currentChallenge.id && <form action={replaceTowerChallengeAction} className="flex flex-col gap-2 rounded-lg bg-surface-hover p-3">
            <p className="text-sm text-foreground">Ce défi demande {replacementOffer.gameName ? `« ${replacementOffer.gameName} »` : "un jeu"}, absent de ta bibliothèque. Aucun achat n’est obligatoire : tu peux le remplacer une fois par un défi équivalent, sans perdre ton quota.</p>
            <input type="hidden" name="attemptId" value={currentChallenge.id} />
            <button type="submit" className="min-h-11 self-start rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-surface">Remplacer ce défi</button>
          </form>}
        </> : <p className="text-sm text-muted">{community?.towerChallengesEnabled ? "Aucun défi solo en cours. Choisis-en un avec /tower defi sur Discord." : "Les défis ne sont pas encore activés pour cette communauté."}</p>}
      </Card>
      {appealableAttempts.length > 0 && <Card className="flex flex-col gap-3 lg:col-span-2">
        <h2 className="text-lg font-semibold text-foreground">Contester un refus</h2>
        {appealableAttempts.map(attempt => <div key={attempt.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
          <p className="font-medium text-foreground">{attempt.title}{attempt.teamName ? ` · ${attempt.teamName}` : ""}</p>
          <p className="text-sm text-muted">Une contestation motivée est possible dans les 48 heures qui suivent l’annonce du résultat du vote.</p>
          <TowerChallengeAppealForm attemptId={attempt.id} />
        </div>)}
      </Card>}
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Défis d’équipe · aujourd’hui</p>
        {teamStates.status === "TEAM_STATES" && teamStates.teams.length ? teamStates.teams.map(team => <div key={team.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
          <h2 className="font-semibold text-foreground">{team.name}</h2>
          {team.attempt ? <>
            <p className="mt-1 text-sm text-foreground">{team.attempt.title} · {challengeStatus[team.attempt.status] ?? team.attempt.status}</p>
            <p className="whitespace-pre-wrap text-sm text-muted">{team.attempt.instructions}</p>
            <p className="text-xs font-medium text-foreground">{towerProofRuleNotice(team.attempt.allowsPastProof)}</p>
            {team.attempt.proofCode && !team.attempt.allowsPastProof && <p className="rounded-lg bg-surface-hover p-3 text-xs text-muted">
              Code de preuve : <code className="font-semibold text-foreground">{team.attempt.proofCode}</code>. Inscris-le dans le jeu si possible, sinon dans la composition GameNight jointe à la capture. Il associe les éléments, sans prouver la date de capture.
            </p>}
            <p className="text-xs text-muted">{team.attempt.participantCount} participant(s) confirmé(s) · +{team.attempt.rewardFloors} étage(s) personnel(s) chacun</p>
            <p className="text-xs text-muted">{team.attempt.joined
              ? team.attempt.pendingReward ? "Ta récompense attend la remise à zéro du plafond quotidien."
                : team.attempt.status === "APPROVED" && team.attempt.userRewarded ? "Tes étages personnels sont crédités."
                  : "Tu participes à ce défi d’équipe."
              : "Tu n’as pas encore rejoint ce défi d’équipe."}</p>
          </> : <p className="mt-1 text-sm text-muted">Défi du jour à ouvrir dans Discord avec /tower equipe.</p>}
        </div>) : <p className="text-sm text-muted">{community?.communityTeamsEnabled ? "Aucune équipe active pour ton compte." : "Les équipes ne sont pas activées pour cette communauté."}</p>}
        <p className="text-xs text-muted">Une réussite confirmée ajoute des étages personnels aux participants inscrits ; aucun score ni étage d’équipe supplémentaire n’est créé.</p>
      </Card>
    </section>

    <section className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]" aria-label="Saison et classement">
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Saison communautaire</p>
        <h2 className="text-xl font-semibold text-foreground">{season.name}</h2>
        <p className="text-sm text-muted">{season.active ? "Saison en cours" : "Saison terminée · dernier classement"}</p>
        <p className="text-sm text-muted">Du {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(season.startAt)} au {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(season.endAt)} · fuseau Europe/Paris.</p>
        <p className="text-xs text-muted">Calendrier Tower commun : S1 de décembre à mars, S2 d’avril à juin, Été en juillet-août, S3 de septembre à novembre. Chaque saison se termine à minuit (Paris) le premier jour de la suivante ; il n’y a pas d’intersaison.</p>
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div><p className="text-sm font-medium text-accent">Classement des défis</p><h2 className="text-xl font-semibold text-foreground">Top saisonnier</h2></div>
          <Link href="/saisons" className="text-sm font-medium text-accent underline-offset-4 hover:underline">Toutes les saisons →</Link>
        </div>
        {leaderboard.status === "LEADERBOARD" && leaderboard.entries.length ? <ol className="flex flex-col gap-2">
          {leaderboard.entries.map((entry, index) => <li key={entry.discordId} className="flex items-center justify-between gap-3 rounded-xl bg-surface-hover px-3 py-2">
            <span className="text-foreground">{index + 1}. {nameByDiscordId.get(entry.discordId) ?? "Membre"}</span>
            <span className="whitespace-nowrap text-sm text-muted">+{entry.rewardFloors} étage(s)</span>
          </li>)}
        </ol> : <p className="text-sm text-muted">{leaderboard.status === "LEADERBOARD" ? "Aucune réussite récompensée pour cette saison." : "Le classement apparaîtra quand les défis seront activés."}</p>}
        <p className="text-xs text-muted">Chaque participant reçoit ses propres étages. Le score d’équipe XP GameNight et le détail par membre sont visibles dans <Link href="/equipes" className="text-accent underline-offset-4 hover:underline">Équipes</Link>.</p>
      </Card>
    </section>
  </main>;
}
