import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/current-user";
import { getMemberStats } from "@/lib/member-stats";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { getTowerChallengeState, getTowerSeasonLeaderboard, getTowerTeamDailyStates } from "@/lib/tower-challenges";
import { getTowerSchoolSeason } from "@/lib/tower-challenge-seasons";
import { getTowerProgress } from "@/lib/tower-progression";
import { prisma } from "@/lib/prisma";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("The Tower");

const challengeStatus: Record<string, string> = {
  ASSIGNED: "À réaliser", SUBMITTED: "En vote", APPROVED: "Réussi", REJECTED: "Refusé",
};

export default async function TowerPage() {
  const user = await getCurrentUser({ recordActivity: false });
  if (!user) redirect("/");

  const communityId = await resolveActiveCommunityId(user.id);
  if (!communityId) {
    return <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-semibold text-foreground">The Tower</h1>
      <Card><p className="text-muted">Choisis une communauté active pour voir tes défis et ton classement.</p></Card>
    </main>;
  }

  const [community, stats, challenges, leaderboard, teamStates] = await Promise.all([
    prisma.community.findUnique({ where: { id: communityId }, select: {
      name: true, towerLevelsPerFloor: true, towerChallengesEnabled: true, communityTeamsEnabled: true, discordGuildId: true,
    } }),
    getMemberStats(user.id, communityId),
    getTowerChallengeState({ communityId, userId: user.id }),
    getTowerSeasonLeaderboard({ communityId, userId: user.id }),
    getTowerTeamDailyStates({ communityId, userId: user.id }),
  ]);
  const ascension = getTowerProgress(stats?.xpTotal ?? 0, community?.towerLevelsPerFloor ?? 10);
  const season = leaderboard.status === "LEADERBOARD" ? leaderboard.season : getTowerSchoolSeason();
  const currentChallenge = challenges.status === "STATE"
    ? challenges.attempts.find(attempt => attempt.status === "ASSIGNED" || attempt.status === "SUBMITTED")
    : null;
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
    </header>

    <section className="grid gap-4 md:grid-cols-2" aria-label="Progression personnelle">
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Ascension · XP GameNight</p>
        <h2 className="text-2xl font-semibold text-foreground">Étage {ascension.floor}</h2>
        <p className="text-sm text-muted">Niveau {ascension.level} · {Math.floor(ascension.progress * 100)} % vers le prochain étage</p>
        <Link href="/ascension" className="text-sm font-medium text-accent underline-offset-4 hover:underline">Voir le détail de l’ascension →</Link>
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Étages remportés par les défis</p>
        <h2 className="text-2xl font-semibold text-foreground">Étage {challenges.status === "STATE" ? challenges.floor : "1"}</h2>
        <p className="text-sm text-muted">Ce compteur alimente le classement Tower. Il reste distinct de l’ascension XP afin de ne pas compter deux fois une réussite.</p>
      </Card>
    </section>

    <section className="grid gap-4 lg:grid-cols-2" aria-label="Défis en cours">
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Défi solo</p>
        {currentChallenge ? <>
          <h2 className="text-xl font-semibold text-foreground">{currentChallenge.title}</h2>
          <p className="text-sm text-muted">{challengeStatus[currentChallenge.status] ?? currentChallenge.status} · +{currentChallenge.rewardFloors} étage(s) personnels</p>
          <p className="whitespace-pre-wrap text-sm text-foreground">{currentChallenge.instructions}</p>
          <p className="text-xs text-muted">Échéance : {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" }).format(currentChallenge.expiresAt)} (Paris)</p>
        </> : <p className="text-sm text-muted">{community?.towerChallengesEnabled ? "Aucun défi solo en cours. Choisis-en un avec /tower defi sur Discord." : "Les défis ne sont pas encore activés pour cette communauté."}</p>}
      </Card>
      <Card className="flex flex-col gap-3">
        <p className="text-sm font-medium text-accent">Défis d’équipe · aujourd’hui</p>
        {teamStates.status === "TEAM_STATES" && teamStates.teams.length ? teamStates.teams.map(team => <div key={team.id} className="border-t border-border pt-3 first:border-0 first:pt-0">
          <h2 className="font-semibold text-foreground">{team.name}</h2>
          {team.attempt ? <>
            <p className="mt-1 text-sm text-foreground">{team.attempt.title} · {challengeStatus[team.attempt.status] ?? team.attempt.status}</p>
            <p className="whitespace-pre-wrap text-sm text-muted">{team.attempt.instructions}</p>
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
        <p className="text-sm text-muted">{season.active ? "Trimestre en cours" : "Intersaison · dernier classement"}</p>
        <p className="text-sm text-muted">Du {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(season.startAt)} au {new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Europe/Paris" }).format(season.endAt)} · fuseau Europe/Paris.</p>
        <p className="text-xs text-muted">Convention Tower commune inspirée du rythme scolaire parisien (septembre–décembre, janvier–mars, avril–juin). Ce ne sont pas les dates officielles d’un lycée ; les calendriers de vacances varient par académie, et les dates de l’établissement ne sont pas paramétrées.</p>
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
