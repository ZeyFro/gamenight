import { withCommunityReadContext } from "@/lib/community-read-context";
import Image from "next/image";
import Link from "next/link";
import { signIn, signOut } from "@/auth";
import { getCurrentUser } from "@/lib/current-user";
import { requireCommunityChosen } from "@/lib/community-picker";
import { prisma } from "@/lib/prisma";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { closeSessionIfDue } from "@/lib/sessions";
import { SESSION_STATUS_LABELS } from "@/lib/session-status";
import { formatDateTimeFr, formatDurationFr, nowMs, wallClockNow } from "@/lib/wallclock";
import { getRecentActivity, getGroupStats, getWeekAvailability, getRecentGameNews } from "@/lib/home";
import { getScoreboard } from "@/lib/scoreboard";
import { getScoreboardCommunityId } from "@/lib/community-access";
import { levelForXp, rankForLevel, titleForLevel } from "@/lib/xp";
import { getCurrentWeeklyChallengeForViewer } from "@/lib/weekly-challenges";
import { getActiveDebts, getActiveDebtorIds } from "@/lib/debts";
import { listGroupAchievements } from "@/lib/group-achievements";
import { setDebtGageAction, markDebtPaidAction } from "@/app/dettes/actions";
import { getMonthlyRecap } from "@/lib/monthly-recap";
import { accessibleSessionWhereFor } from "@/lib/session-access";
import { ensureActiveSeasonExistsForViewer, getSeasonProgress } from "@/lib/seasons";
import { getActiveTournament } from "@/lib/tournaments";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { CountUp } from "@/components/ui/CountUp";
import { FloatingParticles } from "@/components/FloatingParticles";
import { ParallaxHeader } from "@/components/ui/ParallaxHeader";
import { Avatar } from "@/components/ui/Avatar";
import { LoginLanding } from "@/components/app/LoginLanding";
import { XpProgress } from "@/components/app/XpProgress";
import { EmptySessionHero, HomePlanningLinks, HomeInstantLink } from "@/components/app/HomePlanning";
import { AuroraText } from "@/components/magicui/aurora-text";
import { ShineBorder } from "@/components/magicui/shine-border";
import { RankAvatar } from "@/components/RankAvatar";
import { PodiumSpot } from "@/components/PodiumSpot";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Stagger, StaggerItem } from "@/components/motion";

// Fix bug remonté (certains utilisateurs ne peuvent pas se connecter,
// erreur "pkceCodeVerifier value could not be parsed" côté serveur) —
// Auth.js masque volontairement la vraie cause derrière `error=Configuration`
// pour tout `InvalidCheck`/`CallbackRouteError` (voir `auth.ts`, callback
// `logger.error`, qui logue la vraie cause côté serveur). `trustHost`
// est déjà activé et `AUTH_URL` déjà documentée comme requise (voir
// README) — les deux pistes de fix habituelles pour ce type d'erreur.
// La cause la plus probable restante pour un sous-ensemble d'utilisateurs
// seulement : le cookie PKCE ne survit pas à l'aller-retour vers Discord
// dans le navigateur intégré de l'appli Discord (ou d'une appli tierce),
// notoirement agressif sur la suppression de cookies entre deux domaines
// — un vrai navigateur (Safari/Chrome) n'a pas ce problème. Message
// explicite plutôt que générique, pour donner une action concrète aux
// utilisateurs concernés sans qu'ils aient besoin de nous contacter.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  Configuration:
    "La connexion a échoué (erreur serveur pendant l'aller-retour avec Discord). Si tu as cliqué sur le lien depuis l'appli Discord ou une autre appli, réessaie en ouvrant ce site dans ton navigateur (Safari, Chrome…) plutôt que dans leur fenêtre intégrée. Sinon, réessaie dans un instant — si ça persiste, préviens l'admin.",
  AccessDenied: "La connexion a été refusée.",
  OAuthCallbackError:
    "La connexion Discord a échoué (lien de connexion expiré ou déjà utilisé). Réessaie.",
  Verification: "Le lien de connexion n'est plus valide. Réessaie.",
};

// Fix UX (PR 9/9) : ne matche que la forme exacte `/potes/<id>` — jamais
// une URL absolue ni un autre chemin — pour que `redirectTo` ne puisse
// jamais devenir un open redirect, même avant la vérification en base.
const POTE_REDIRECT_PATTERN = /^\/potes\/([a-zA-Z0-9]+)$/;

export default function Home(props: { searchParams: Promise<{ error?: string; redirect?: string }> }) {
  return withCommunityReadContext(() => HomeContent(props));
}

async function HomeContent({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; redirect?: string }>;
}) {
  // Feature "forcer la reconnexion globale" (PR 75) — un ancien code
  // utilisait `auth()` directement ici pour décider d'afficher la page de
  // connexion (`session?.user` reste vrai pour un JWT posé avant un
  // `forceReloginAt`, Auth.js ne sait rien de ce marqueur, purement
  // applicatif). `getCurrentUser()` est la seule source de vérité qui en
  // tient compte (renvoie `null` dans ce cas) — sans ce changement, la
  // page serait tombée dans la branche "connecté" plus bas puis aurait
  // rendu une page blanche au lieu du bouton de connexion, l'inverse du
  // but de la feature.
  const user = await getCurrentUser();
  const { error, redirect: redirectParam } = await searchParams;
  const errorMessage = error
    ? (AUTH_ERROR_MESSAGES[error] ??
      "La connexion a échoué. Réessaie dans un instant.")
    : null;

  if (!user) {
    let redirectTarget: { path: string; pseudo: string } | null = null;
    const match = redirectParam ? POTE_REDIRECT_PATTERN.exec(redirectParam) : null;
    if (match) {
      const targetUser = await prisma.user.findUnique({
        where: { id: match[1] },
        select: { discordName: true },
      });
      if (targetUser) redirectTarget = { path: redirectParam!, pseudo: targetUser.discordName };
    }

    return (
      <LoginLanding>

          {errorMessage && (
            <p className="w-full rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {errorMessage}
            </p>
          )}


          {redirectTarget && (
            <p className="w-full rounded-lg bg-accent/10 p-3 text-sm text-accent">
              Tu vas voir le profil de {redirectTarget.pseudo} après connexion.
            </p>
          )}

          <form
            action={async () => {
              "use server";
              await signIn(
                "discord",
                redirectTarget ? { redirectTo: redirectTarget.path } : undefined
              );
            }}
            className="w-full"
          >
            <Button
              type="submit"
              variant="primary"
              fullWidthOnMobile
              className="w-full gap-2"
            >
              Se connecter avec Discord
            </Button>
          </form>
      </LoginLanding>
    );
  }

  await requireCommunityChosen(user.id, "/");
  const scopedDb = await getActiveScopedPrisma(user.id);

  const dueSession = await scopedDb.session.findFirst({
    where: { status: "VOTING", date: { lte: wallClockNow() }, ...(await accessibleSessionWhereFor(user.id)) },
    select: { id: true },
    orderBy: { date: "asc" },
  });
  if (dueSession) await closeSessionIfDue(dueSession.id);

  // Garde-fou idempotent — voir le commentaire sur `ensureActiveSeasonExistsForViewer`
  // (src/lib/seasons.ts).
  await ensureActiveSeasonExistsForViewer(user.id);

  const [
    nextSession,
    activity,
    groupStats,
    weekAvailability,
    scoreboard,
    gameNews,
    weeklyChallenge,
    groupAchievements,
    activeDebts,
    activeDebtorIds,
  ] = await Promise.all([
    prisma.session.findFirst({
      // Confidentialité des soirées — "Prochaine soirée" ne doit jamais
      // révéler une soirée privée à laquelle l'utilisateur n'est ni
      // créateur ni invité (voir src/lib/session-access.ts).
      where: { status: { in: ["VOTING", "SCHEDULED"] }, ...(await accessibleSessionWhereFor(user.id)) },
      orderBy: { date: "asc" },
      include: {
        decidedGame: { select: { name: true, coverUrl: true } },
        proposals: {
          select: {
            gameId: true,
            game: { select: { coverUrl: true } },
            votes: { select: { userId: true } },
          },
        },
      },
    }),
    getRecentActivity(user.id, 3),
    getGroupStats(user.id),
    getWeekAvailability(user.id),
    getScoreboard("global", { communityId: await getScoreboardCommunityId(user.id) }),
    getRecentGameNews(),
    getCurrentWeeklyChallengeForViewer(user.id),
    listGroupAchievements(user.id),
    getActiveDebts(user.id),
    getActiveDebtorIds(user.id),
  ]);

  // Sprint 4 — card "📊 Recap" (mois dernier, si déjà généré par le cron
  // `monthly-tasks`) et barre de progression de la saison en cours.
  const wallNow = wallClockNow();
  const prevMonthDate = new Date(Date.UTC(wallNow.getUTCFullYear(), wallNow.getUTCMonth() - 1, 1));
  const recapYear = prevMonthDate.getUTCFullYear();
  const recapMonth = prevMonthDate.getUTCMonth() + 1;
  const [lastMonthRecap, seasonProgress, activeTournament] = await Promise.all([
    getMonthlyRecap(recapYear, recapMonth, user.id),
    getSeasonProgress(user.id),
    getActiveTournament(user.id),
  ]);

  // Refonte home : cover du jeu décidé si la soirée est SCHEDULED, sinon
  // celle de la proposition la plus votée (VOTING) — même logique que
  // `bestSlot`/`topGroup` ailleurs (max sur un tableau déjà en mémoire, pas
  // besoin d'une requête triée dédiée pour si peu de propositions).
  const topProposal = nextSession?.proposals.reduce<
    (typeof nextSession.proposals)[number] | null
  >((best, p) => (!best || p.votes.length > best.votes.length ? p : best), null);
  const nextSessionCoverUrl = nextSession?.decidedGame?.coverUrl ?? topProposal?.game.coverUrl ?? null;

  // "Joueurs inscrits" : voteurs de la proposition gagnante une fois le
  // jeu décidé (mêmes personnes que le "Qui vient" Discord), sinon
  // l'ensemble des voteurs toutes propositions confondues (VOTING) — un
  // vote pour n'importe quel jeu proposé compte comme un "je suis
  // partant", cohérent avec le sens de "inscrit" avant que le jeu ne soit
  // tranché.
  const registeredPlayerIds = new Set<string>();
  if (nextSession) {
    const relevantProposals = nextSession.decidedGameId
      ? nextSession.proposals.filter((p) => p.gameId === nextSession.decidedGameId)
      : nextSession.proposals;
    for (const p of relevantProposals) {
      for (const v of p.votes) registeredPlayerIds.add(v.userId);
    }
  }

  const now = nowMs();
  const level = levelForXp(user.xpTotal);
  const rank = rankForLevel(level);
  const title = titleForLevel(level);
  const podium = scoreboard.slice(0, 3);
  const [first, second, third] = podium;

  return (
    <PullToRefresh>
    <div className="gn-home-shell mx-auto flex w-full flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
      <div className="gn-page-heading">
        <div><p className="gn-eyebrow mb-3">Ensemble, c’est toujours mieux</p><h1><AuroraText colors={["#b99aff", "#e3cffc", "#d4ef80"]}>Ce soir, on joue à quoi ?</AuroraText></h1><p>Un jeu à choisir. Des potes à retrouver. Une bonne soirée à lancer.</p></div>
        <ButtonLink href="/sessions" variant="primary" className="hidden sm:inline-flex">+ Créer une soirée</ButtonLink>
      </div>
      <nav className="gn-quick-actions" aria-label="Lancer une partie">
        <Link href="/sessions" prefetch={false} className="gn-quick-action"><span aria-hidden="true">☾</span><div><b>Créer une soirée</b><small>Un rendez-vous avec les potes</small></div></Link>
        <Link href="/roulette?mode=instant" prefetch={false} className="gn-quick-action"><span aria-hidden="true">🎲</span><div><b>Roulette instantanée</b><small>Choisir un jeu maintenant</small></div></Link>
        <Link href="/tournois/creer" prefetch={false} className="gn-quick-action"><span aria-hidden="true">🏆</span><div><b>Lancer un tournoi</b><small>Qui ira jusqu’au bout ?</small></div></Link>
      </nav>
      <ParallaxHeader className="gn-home-greeting relative flex items-center gap-4">
        <FloatingParticles />
        <RankAvatar
          src={user.discordAvatar}
          alt={`Avatar de ${user.discordName}`}
          level={level}
          rank={rank}
          size={64}
        />
        <div className="min-w-0">
          <p className="text-sm text-muted">Salut,</p>
          <h2 className="truncate text-xl font-semibold text-foreground sm:text-2xl">
            {user.discordName}
            {activeDebtorIds.has(user.id) && (
              <span className="ml-1" title="Dette de gage active">
                💀
              </span>
            )}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Niveau {level} · {title} · {rank.name}
          </p>
        </div>
        {/* FIX1 (retours visuels post-Sprint2) : le bouton "?" flottant
            (`GuideFab`) est discret par design (coin d'écran, toujours
            visible) — pas assez visible en tant que point d'entrée
            principal vers le guide pour un nouvel utilisateur. Lien
            explicite ici, juste après l'en-tête, en plus du FAB (les deux
            coexistent, cf. spec). */}
        <ButtonLink href="/guide" variant="ghost" size="sm" className="shrink-0 !px-2">
          📖 Guide
        </ButtonLink>
      </ParallaxHeader>

      <Stagger className="gn-home-sections" staggerDelay={0.04}>
        {/* Prochaine soirée + Stats du groupe côte à côte sur desktop —
            l'espace vide à gauche/droite était le retour le plus fréquent
            en desktop (cf. README, section dédiée). */}
        <div className="gn-home-overview">
        <StaggerItem className="gn-home-play-column">
          {nextSession ? (
            <Link href={`/sessions/${nextSession.id}`}>
              {/* Pas de `Card` ici : `Card` impose son propre padding via
                  une classe fixe, pas fiable à écraser avec une classe
                  `p-0` passée en `className` (l'ordre de règles généré par
                  Tailwind ne garantit pas la victoire de la classe la plus
                  récente dans le JSX) — mêmes classes visuelles que `Card
                  glow` reproduites à la main pour pouvoir placer l'image de
                  fond en position absolue derrière un padding interne. */}
              <div className="gn-home-feature relative overflow-hidden rounded-xl border border-border bg-surface transition-all duration-200 hover:card-glow">
                {nextSessionCoverUrl && (
                  <>
                    <Image
                      src={nextSessionCoverUrl}
                      alt=""
                      fill
                      sizes="(min-width: 1024px) 1152px, 100vw"
                      className="object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/80 to-surface/40" />
                  </>
                )}
                <ShineBorder shineColor={["#b99aff", "#d4ef80"]} aria-hidden="true" />
                <div className="relative flex items-start justify-between gap-3 p-6 sm:p-8">
                  <div className="min-w-0">
                    <p className="text-sm text-muted">Prochaine soirée</p>
                    <p className="mt-1 text-lg font-semibold text-foreground capitalize">
                      {formatDateTimeFr(nextSession.date)}
                    </p>
                    <p className="mt-1 truncate text-sm text-muted">
                      {nextSession.decidedGame
                        ? nextSession.decidedGame.name
                        : `${nextSession.proposals.length} proposition${nextSession.proposals.length === 1 ? "" : "s"}`}
                    </p>
                    {registeredPlayerIds.size > 0 && (
                      <p className="mt-1 text-xs text-muted">
                        {registeredPlayerIds.size} joueur{registeredPlayerIds.size === 1 ? "" : "s"} inscrit
                        {registeredPlayerIds.size === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium ${SESSION_STATUS_LABELS[nextSession.status].className}`}
                  >
                    {SESSION_STATUS_LABELS[nextSession.status].label}
                  </span>
                </div>
              </div>
            </Link>
          ) : (
            <EmptySessionHero />
          )}
          <HomePlanningLinks />
          <HomeInstantLink />
        </StaggerItem>

        {/* Stats du groupe */}
        <StaggerItem className="flex flex-col gap-4">
          <XpProgress xp={user.xpTotal} />
          <Card className="gradient-border">
            <p className="text-lg font-semibold text-foreground">Stats du groupe</p>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <CountUp
                  value={groupStats.totalSessionsPlayed}
                  className="text-lg font-semibold tabular-nums text-foreground"
                />
                <p className="text-xs text-muted">
                  soirée{groupStats.totalSessionsPlayed === 1 ? "" : "s"} jouée
                  {groupStats.totalSessionsPlayed === 1 ? "" : "s"}
                </p>
              </div>
              <div>
                <CountUp
                  value={groupStats.activePlayers}
                  className="text-lg font-semibold tabular-nums text-foreground"
                />
                <p className="text-xs text-muted">
                  joueur{groupStats.activePlayers === 1 ? "" : "s"} actif
                  {groupStats.activePlayers === 1 ? "" : "s"}
                </p>
              </div>
              {groupStats.mostPlayedGame && (
                <div className="col-span-2 flex items-center gap-3">
                  {groupStats.mostPlayedGame.coverUrl && (
                    <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                      <Image
                        src={groupStats.mostPlayedGame.coverUrl}
                        alt=""
                        width={40}
                        height={56}
                        className="h-full w-full object-cover"
                      />
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {groupStats.mostPlayedGame.name}
                    </p>
                    <p className="text-xs text-muted">
                      Jeu le plus joué · {groupStats.mostPlayedGame.count} fois
                    </p>
                  </div>
                </div>
              )}
              {groupStats.bestActiveStreak && (
                <div className="col-span-2">
                  <p className="text-sm font-medium text-foreground">
                    🔥 {groupStats.bestActiveStreak.discordName}
                  </p>
                  <p className="text-xs text-muted">
                    Meilleur streak actif · {groupStats.bestActiveStreak.streakCount} jour
                    {groupStats.bestActiveStreak.streakCount === 1 ? "" : "s"}
                  </p>
                </div>
              )}
            </div>
          </Card>
        </StaggerItem>
        </div>

        {/* Défi hebdo (Sprint 3 suite) — généré paresseusement pour la
            semaine en cours par `getCurrentWeeklyChallengeForViewer` ci-dessus. La
            complétion se fait depuis une soirée DONE (bouton créateur),
            jamais directement ici — la Home reste en lecture seule. */}
        {weeklyChallenge && (
          <StaggerItem className="gn-home-wide">
          <Card className="gn-home-challenge gradient-border">
            <p className="text-lg font-semibold text-foreground">🎯 Défi de la semaine</p>
            <p className="mt-2 text-foreground">{weeklyChallenge.description}</p>
            <p className={`mt-2 text-sm ${weeklyChallenge.completedAt ? "text-accent" : "text-muted"}`}>
              {weeklyChallenge.completedAt
                ? "✅ Complété !"
                : "Complète-le depuis une soirée terminée cette semaine."}
            </p>
          </Card>
        </StaggerItem>
        )}

        {/* Activité récente + Dispos de la semaine côte à côte sur desktop */}
        <div className="gn-home-pair">
        <StaggerItem>
          <Card className="gradient-border">
            <p className="text-lg font-semibold text-foreground">Activité récente</p>
            {activity.length === 0 ? (
              <EmptyState icon="📡" title="L'activité du groupe apparaîtra ici" className="mt-3" />
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {activity.map((item) => (
                  <li key={item.id} className="flex items-center gap-3">
                    <span className="text-lg shrink-0" aria-hidden>
                      {item.icon}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-sm text-foreground">{item.text}</p>
                    <span className="shrink-0 text-xs text-muted">
                      il y a {formatDurationFr(now - item.timestamp.getTime())}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </StaggerItem>

        {/* Dispos de la semaine */}
        <StaggerItem>
          <Card className="gradient-border">
            <p className="text-lg font-semibold text-foreground">Dispos de la semaine</p>
            <div className="mt-3 grid grid-cols-7 gap-1.5 sm:gap-2">
              {weekAvailability.map((day) => (
                <Link
                  key={day.date.toISOString()}
                  href={day.href}
                  className={`flex flex-col items-center gap-1 rounded-lg border p-2 text-center transition-colors ${
                    day.isBest
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-border text-foreground hover:bg-surface-hover"
                  }`}
                >
                  <span className="text-[10px] uppercase text-muted">{day.label.slice(0, 3)}</span>
                  <span className="text-sm font-semibold">
                    {day.availableCount}/{day.totalUsers}
                  </span>
                </Link>
              ))}
            </div>
          </Card>
        </StaggerItem>
        </div>

        {/* Sprint 4 (Saisons mensuelles) — barre de progression de la
            saison en cours, masquée si aucune saison active (ne devrait
            pas arriver post-bootstrap, cf. ensureActiveSeasonExistsForViewer dans
            src/lib/seasons.ts, appelée juste au-dessus). */}
        {seasonProgress && (
          <StaggerItem>
            <Link href="/saisons">
              <Card className="flex flex-col gap-2">
                <p className="text-sm text-muted">
                  🏆 {seasonProgress.name} — Jour {seasonProgress.dayOfMonth}/
                  {seasonProgress.totalDays}
                </p>
                <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{
                      width: `${Math.min(100, (seasonProgress.dayOfMonth / seasonProgress.totalDays) * 100)}%`,
                    }}
                  />
                </div>
              </Card>
            </Link>
          </StaggerItem>
        )}

        {/* Sprint 4 (Recap mensuel Wrapped) — n'apparaît qu'une fois le
            recap du mois dernier généré par le cron `monthly-tasks`
            (silencieux tant qu'il n'existe pas, jamais de placeholder
            vide). */}
        {lastMonthRecap && (
          <StaggerItem>
            <Link href={`/recap/${recapYear}/${recapMonth}`}>
              <Card className="card-glow flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-foreground">
                  📊 Le recap du mois dernier est prêt !
                </p>
                <span className="text-accent">→</span>
              </Card>
            </Link>
          </StaggerItem>
        )}

        {/* Sprint 5 (Tournois Bracket) — tournoi actif (inscriptions
            ouvertes OU en cours), masquée s'il n'y en a aucun. */}
        {activeTournament && (
          <StaggerItem>
            <Link href={`/tournois/${activeTournament.id}`}>
              <Card className="card-glow flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">
                    🏆 Tournoi en cours : {activeTournament.name}
                  </p>
                  <p className="truncate text-xs text-muted">{activeTournament.gameName}</p>
                </div>
                <span className="shrink-0 text-accent">→</span>
              </Card>
            </Link>
          </StaggerItem>
        )}

        {/* Actu gaming (Sprint 3) — cache uniquement (`GameNews`, rafraîchi
            par `runGameNewsBackfill`, jamais l'API Steam directement ici),
            entièrement masquée s'il n'y a aucune actu en cache (spec). */}
        {gameNews.length > 0 && (
          <StaggerItem>
            <Card className="gradient-border">
              <p className="text-lg font-semibold text-foreground">📰 Actu gaming</p>
              <ul className="mt-3 flex flex-col gap-3">
                {gameNews.map((item) => (
                  <li key={item.id}>
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg transition-colors hover:bg-surface-hover"
                    >
                      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md bg-surface-hover">
                        {item.gameCoverUrl && (
                          <Image
                            src={item.gameCoverUrl}
                            alt=""
                            width={32}
                            height={32}
                            className="h-full w-full object-cover"
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-foreground">{item.title}</p>
                        <p className="truncate text-xs text-muted">{item.gameName}</p>
                      </div>
                      <span className="shrink-0 text-xs text-faint">
                        il y a {formatDurationFr(now - item.publishedAt.getTime())}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </Card>
          </StaggerItem>
        )}

        {/* Trophées du groupe (Sprint 3 suite) — encyclopédique comme
            `BadgeGrid` : les 10 lignes sont toujours affichées, débloquées
            en couleur, verrouillées grisées. */}
        <StaggerItem>
          <Card className="gradient-border">
            <p className="text-lg font-semibold text-foreground">🏅 Trophées du groupe</p>
            <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-5">
              {groupAchievements.map((a) => (
                <div
                  key={a.id}
                  title={`${a.name} — ${a.description}`}
                  className={`flex flex-col items-center gap-1 text-center ${
                    a.unlockedAt ? "" : "opacity-30 grayscale"
                  }`}
                >
                  <span className="text-2xl">{a.icon}</span>
                  <span className="w-full truncate text-[10px] text-muted">{a.name}</span>
                </div>
              ))}
            </div>
          </Card>
        </StaggerItem>

        {/* Dettes du groupe (Sprint 3 suite) — toujours affichée (polish
            visuel : état vide célébré plutôt que section masquée, cf.
            demande explicite) au lieu de disparaître s'il n'y a aucune
            dette active. Définir le gage/marquer soldée réservé au
            créateur de la soirée qui a généré la dette (mêmes gardes côté
            serveur dans `src/app/dettes/actions.ts`). */}
        <StaggerItem>
          <Card className="gradient-border">
            <p className="text-lg font-semibold text-foreground">💀 Dettes du groupe</p>
            {activeDebts.length === 0 ? (
              <EmptyState
                icon="✨"
                title="Personne ne doit rien — bravo le groupe !"
                className="mt-3"
              />
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {activeDebts.map((debt) => {
                  const isDebtCreator = debt.session.createdById === user.id;
                  return (
                    <li
                      key={debt.id}
                      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
                    >
                      <div className="flex items-center gap-2">
                        <Avatar
                          src={debt.debtor.discordAvatar}
                          alt={debt.debtor.discordName}
                          size={24}
                        />
                        <span className="text-sm font-medium text-foreground">
                          {debt.debtor.discordName}
                        </span>
                      </div>
                      <p className="text-xs text-muted">{debt.reason}</p>
                      {debt.gage ? (
                        <p className="text-sm text-accent">Gage : {debt.gage}</p>
                      ) : (
                        <p className="text-xs text-warning">Gage pas encore défini.</p>
                      )}
                      {isDebtCreator && (
                        <div className="flex flex-wrap items-center gap-2">
                          <form action={setDebtGageAction} className="flex flex-1 gap-2">
                            <input type="hidden" name="debtId" value={debt.id} />
                            <input
                              type="text"
                              name="gage"
                              aria-label="Gage"
                              placeholder="Définir le gage…"
                              defaultValue={debt.gage ?? ""}
                              className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground placeholder:text-faint focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                            />
                            <Button type="submit" variant="secondary" size="sm">
                              OK
                            </Button>
                          </form>
                          <form action={markDebtPaidAction}>
                            <input type="hidden" name="debtId" value={debt.id} />
                            <Button type="submit" variant="ghost" size="sm">
                              Soldée
                            </Button>
                          </form>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </StaggerItem>

        {/* Classement rapide */}
        <StaggerItem>
          <Card className="gradient-border">
            <div className="flex items-center justify-between">
              <p className="text-lg font-semibold text-foreground">Classement rapide</p>
              <Link href="/classement" className="text-xs font-medium text-accent hover:underline">
                Voir tout
              </Link>
            </div>
            {podium.length === 0 ? (
              <p className="mt-3 text-sm text-muted">Personne dans le groupe pour l&apos;instant.</p>
            ) : (
              <div className="mt-4 flex items-end justify-center gap-2 sm:gap-4">
                {second && <PodiumSpot entry={second} place={2} />}
                {first && <PodiumSpot entry={first} place={1} />}
                {third && <PodiumSpot entry={third} place={3} />}
              </div>
            )}
          </Card>
        </StaggerItem>

        <StaggerItem className="gn-home-wide grid grid-cols-2 gap-4">
          <ButtonLink href="/disponibilites" variant="secondary" size="sm">
            Mes dispos
          </ButtonLink>
          <ButtonLink href="/sessions" variant="secondary" size="sm">
            Soirées
          </ButtonLink>
        </StaggerItem>
      </Stagger>

      <form
        action={async () => {
          "use server";
          await signOut();
        }}
      >
        <Button type="submit" variant="ghost" size="sm">
          Se déconnecter
        </Button>
      </form>
    </div>
    </PullToRefresh>
  );
}
