import { plural } from "@/lib/plural";
import { otherMembersLabel } from "@/lib/group-stats-rules";
import { getGroupMemberCounts } from "@/lib/member-counts";
import { FriendsPanel } from "@/components/potes/FriendsPanel";
import { isFriendsEnabled, normalizeFriendSearch } from "@/lib/friends-rules";
import { listFriendIds, listFriendRequests, searchMembersByName } from "@/lib/friends";
import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { creationMemberUserWhere } from "@/lib/community-isolation";
import { getActiveScopedPrisma } from "@/lib/community-scoped-client";
import { projectUserProgress, ZERO_MEMBER_STATS } from "@/lib/member-stats";
import { writeCommunityIdForUser } from "@/lib/community-stats";
import { levelForXp, rankForLevel } from "@/lib/xp";
import { getActiveDebtorIds } from "@/lib/debts";
import { tagColor } from "@/lib/tags";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { BannerImage } from "@/components/BannerImage";
import { ColorDot } from "@/components/ColorDot";
import { StreakFlame } from "@/components/StreakFlame";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Stagger, StaggerItem } from "@/components/motion";
import { nowMs } from "@/lib/wallclock";
import { formatSteamActivityLabel } from "@/lib/steam";
import { activeNowPlaying, isNowPlayingEnabled } from "@/lib/steam-now-playing";
import { NowPlayingBadge } from "@/components/NowPlayingBadge";
import { pageMetadata } from "@/lib/page-title";
import { getProfileVisibility, isProfileVisibilityEnabled, profileVisibilityWhere } from "@/lib/profile-visibility";
import { Button } from "@/components/ui/Button";
import { setProfileVisibilityAction } from "./visibility-actions";
import { gameLevelUserWhere, levelKey, loadVisibleLevels, parseGameLevelFilter } from "@/lib/game-level-filter";
import { GAME_LEVELS, GAME_LEVEL_LABELS, isGameLevelsEnabled } from "@/lib/game-levels-rules";
import { COMMUNITY_PREFERENCES, isPlayerMatchingEnabled, parsePlayerMatchingFilters, PLAY_HABITS, PLAYER_LANGUAGES, playerMatchingUserWhere } from "@/lib/player-matching-rules";
import { loadCompatiblePartners } from "@/lib/player-matching";
import { isTonightEnabled } from "@/lib/tonight-rules";

export const metadata = pageMetadata("Potes");

function QuickStat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 rounded-lg bg-background px-2 py-2 text-center">
      <span className="text-sm font-bold text-foreground">{value}</span>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  );
}

export default async function PotesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const levelsEnabled = isGameLevelsEnabled();
  const params = (await searchParams) ?? {};
  const levelFilterParse = levelsEnabled ? parseGameLevelFilter(params) : null;
  // Recherche de joueurs (§12.2) : filtres déclaratifs, toujours combinés aux gardes de communauté et de visibilité.
  const matchingEnabled = isPlayerMatchingEnabled();
  const matchingParse = matchingEnabled ? parsePlayerMatchingFilters(params) : null;
  const matchingFilter = matchingParse?.success ? matchingParse.data : {};
  const matchingFilterInvalid = matchingParse !== null && !matchingParse.success;
  const matchingFiltered = Object.values(matchingFilter).some(Boolean);
  const interestTags = matchingEnabled ? await prisma.tag.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
  const levelFilter = levelFilterParse?.success ? levelFilterParse.data : {};
  const levelFilterInvalid = levelFilterParse !== null && !levelFilterParse.success;
  const levelGames = levelsEnabled ? await prisma.game.findMany({ where: { userLevels: { some: {} } }, select: { id: true, name: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 300 }) : [];

  // Potes = amis (POTES_FRIENDS_ENABLED) : la liste ne montre que mes amis ; demandes et recherche par pseudo à côté.
  const friendsEnabled = isFriendsEnabled();
  const memberCounts = await getGroupMemberCounts(user.id);
  const friendIds = friendsEnabled ? await listFriendIds(user.id) : [];
  const friendRequests = friendsEnabled ? await listFriendRequests(user.id) : { incoming: [], outgoing: [] };
  const searchQuery = friendsEnabled && typeof params.q === "string" ? params.q : "";
  const searchHits = friendsEnabled && normalizeFriendSearch(searchQuery) ? await searchMembersByName(user.id, searchQuery) : null;

  const scopedDb = await getActiveScopedPrisma(user.id);
  const rawPotes = await prisma.user.findMany({
    // Multi-communautés (PR4) : uniquement les membres de mes communautés
    // (aucun filtre si l'isolation est éteinte).
    where: { AND: [{ id: { not: user.id } }, friendsEnabled ? { id: { in: friendIds } } : {}, await creationMemberUserWhere(user.id), profileVisibilityWhere(), levelFilterInvalid ? { id: { in: [] } } : gameLevelUserWhere(levelFilter), matchingFilterInvalid ? { id: { in: [] } } : playerMatchingUserWhere(matchingFilter)] },
    orderBy: { discordName: "asc" },
    select: {
      id: true,
      discordName: true,
      discordAvatar: true,
      color: true,
      bannerUrl: true,
      steamId64: true,
      lastPlayedGame: true,
      lastPlayedAt: true,
      steamNowPlaying: true,
      steamNowPlayingSeenAt: true,
      // Sprint 3 (FEATURE 6) — chips de tags sur la carte pote.
      userTags: { select: { tag: { select: { id: true, name: true } } } },
    },
  });
  const levelByPote = levelFilter.gameId && levelFilter.level
    ? await loadVisibleLevels(user.id, rawPotes.map((pote) => ({ userId: pote.id, gameId: levelFilter.gameId! })))
    : new Map<string, import("@/lib/game-levels-rules").GameLevel>();
  const communityId = await writeCommunityIdForUser(user.id);
  const progress = await scopedDb.communityMemberStats.findMany({ where: { communityId: { in: communityId ? [communityId] : [] }, userId: { in: rawPotes.map((p) => p.id) } } });
  const progressById = new Map(progress.map((p) => [p.userId, p]));
  const potes = rawPotes.map((pote) => projectUserProgress(pote, progressById.get(pote.id) ?? ZERO_MEMBER_STATS));

  // Une seule requête groupée pour "soirées jouées" plutôt que N requêtes
  // (une par pote) — même info que `getProfileStats`, mais cette page a
  // besoin de toutes les cartes d'un coup.
  const sessionsPlayedRows = await scopedDb.xpEvent.groupBy({
    by: ["userId"],
    where: { communityId: { in: communityId ? [communityId] : [] }, userId: { in: potes.map((p) => p.id) }, reason: "PARTICIPATE" },
    _count: { _all: true },
  });
  const sessionsPlayedByUser = new Map(
    sessionsPlayedRows.map((row) => [row.userId, row._count._all])
  );

  // Idem pour le nombre de jeux possédés (même convention que
  // `getProfileStats` : `owned: true`) — une requête groupée pour toutes
  // les cartes plutôt qu'un `count` par pote.
  const gamesOwnedRows = await prisma.userGame.groupBy({
    by: ["userId"],
    where: { userId: { in: potes.map((p) => p.id) }, owned: true },
    _count: { _all: true },
  });
  const gamesOwnedByUser = new Map(
    gamesOwnedRows.map((row) => [row.userId, row._count._all])
  );

  // Sprint 3 suite (dettes/gage) — badge "💀" à côté du pseudo.
  const activeDebtorIds = await getActiveDebtorIds(user.id);

  // Sprint 4 (FEATURE 4) — consultation passive uniquement, calculée une
  // fois pour toute la liste plutôt qu'à chaque carte (`nowMs()` dans le
  // corps du composant casserait la pureté React Compiler, cf. convention
  // déjà établie ailleurs dans l'app).
  const now = nowMs();
  // « En jeu maintenant » : nouveau drapeau, éteint par défaut (alors rien ne change).
  const nowPlayingEnabled = isNowPlayingEnabled();
  // Visibilité du profil : nouveau drapeau, éteint par défaut (alors rien ne change).
  const visibility = isProfileVisibilityEnabled() ? await getProfileVisibility(user.id) : null;
  // Partenaires compatibles (§12.3) : seulement parmi les potes déjà listés (même communauté, profil visible)
  // et, quand des filtres sont actifs, parmi ceux qui y correspondent — jamais un candidat écarté.
  const partners = matchingEnabled && visibility !== "HIDDEN" ? await loadCompatiblePartners(user.id, potes.map((pote) => pote.id)) : [];
  const poteNames = new Map(potes.map((pote) => [pote.id, pote.discordName]));

  return (
    <PullToRefresh>
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <PageHeader
        eyebrow="La communauté"
        title="Potes"
        description={friendsEnabled ? `${potes.length} ${plural(potes.length, "ami")}.` : `${otherMembersLabel(potes.length)} dans le groupe${memberCounts.members > 0 ? ` (${memberCounts.members} avec toi)` : ""}.`}
      />

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        <Link href="/joueurs" className="text-sm font-medium text-accent">🔎 Chercher un joueur ou publier une annonce →</Link>
        {isTonightEnabled() && <Link href="/ce-soir" className="text-sm font-medium text-accent">🌙 Qui joue ce soir ? →</Link>}
      </div>

      {visibility && (
        <Card>
          <form action={setProfileVisibilityAction} className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-foreground">
              {visibility === "HIDDEN"
                ? "Ton profil est masqué : les autres membres ne le trouvent pas dans Potes et ne peuvent pas ouvrir ta fiche."
                : "Ton profil est visible par les membres de ta communauté."}
            </p>
            <input type="hidden" name="visibility" value={visibility === "HIDDEN" ? "COMMUNITY" : "HIDDEN"} />
            <Button type="submit" size="sm">{visibility === "HIDDEN" ? "Rendre mon profil visible" : "Masquer mon profil"}</Button>
          </form>
        </Card>
      )}

      {friendsEnabled && <FriendsPanel incoming={friendRequests.incoming} outgoing={friendRequests.outgoing} query={normalizeFriendSearch(searchQuery) ?? ""} hits={searchHits} />}

      {levelsEnabled && <Card>
        <form action="/potes" method="get" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">Jeu
            <select name="gameId" defaultValue={levelFilter.gameId ?? ""} className="rounded-lg border border-border bg-background px-3 py-2 text-base"><option value="">Choisir un jeu</option>{levelGames.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm">Niveau
            <select name="level" defaultValue={levelFilter.level ?? ""} className="rounded-lg border border-border bg-background px-3 py-2 text-base"><option value="">Tous</option>{GAME_LEVELS.map((level) => <option key={level} value={level}>{GAME_LEVEL_LABELS[level]}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm">Comparaison
            <select name="levelMatch" defaultValue={levelFilter.levelMatch ?? ""} className="rounded-lg border border-border bg-background px-3 py-2 text-base"><option value="">Ce niveau ou plus</option><option value="exact">Ce niveau exactement</option></select>
          </label>
          <Button type="submit" size="sm">Filtrer par niveau</Button>
          <Link href="/potes" className="text-sm text-accent">Réinitialiser</Link>
        </form>
        {levelFilterInvalid && <p role="alert" className="mt-2 text-sm text-destructive">Choisis un jeu pour filtrer par niveau.</p>}
      </Card>}

      {matchingEnabled && <Card>
        <form action="/potes" method="get" className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm">Langue
            <select name="language" defaultValue={matchingFilter.language ?? ""} className="rounded-lg border border-border bg-background px-3 py-2 text-base"><option value="">Toutes</option>{PLAYER_LANGUAGES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm">Habitude
            <select name="habit" defaultValue={matchingFilter.habit ?? ""} className="rounded-lg border border-border bg-background px-3 py-2 text-base"><option value="">Toutes</option>{PLAY_HABITS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm">Ambiance
            <select name="preference" defaultValue={matchingFilter.preference ?? ""} className="rounded-lg border border-border bg-background px-3 py-2 text-base"><option value="">Toutes</option>{COMMUNITY_PREFERENCES.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm">Centre d’intérêt
            <select name="tagId" defaultValue={matchingFilter.tagId ?? ""} className="rounded-lg border border-border bg-background px-3 py-2 text-base"><option value="">Tous</option>{interestTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>
          </label>
          <Button type="submit" size="sm">Filtrer</Button>
          <Link href="/potes" className="text-sm text-accent">Réinitialiser</Link>
        </form>
        {matchingFilterInvalid && <p role="alert" className="mt-2 text-sm text-destructive">Choisis parmi les options proposées.</p>}
      </Card>}

      {partners.length > 0 && <Card>
        <h2 className="font-semibold text-foreground">Partenaires compatibles</h2>
        <p className="mt-1 text-sm text-muted">Proposés parmi les membres affichés d’après vos jeux en commun et vos réponses dans les paramètres. Les profils masqués ne sont jamais proposés.</p>
        <ul className="mt-3 grid gap-2" aria-label="Partenaires compatibles">
          {partners.map((partner) => <li key={partner.userId} className="text-sm">
            <Link href={`/potes/${partner.userId}`} className="font-medium text-accent hover:underline">{poteNames.get(partner.userId)}</Link>
            <span className="text-muted"> · {partner.reasons.join(" · ")}</span>
          </li>)}
        </ul>
      </Card>}

      {potes.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">{matchingFiltered || levelFilter.gameId ? "Aucun membre ne correspond à ces filtres." : friendsEnabled ? <>Tu n&apos;as pas encore d&apos;ami : cherche un joueur par pseudo ci-dessus et envoie-lui une demande.</> : <>Personne d&apos;autre n&apos;a encore rejoint le groupe.</>}</p>
        </Card>
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {potes.map((pote) => {
            const level = levelForXp(pote.xpTotal);
            const rank = rankForLevel(level);
            const sessionsPlayed = sessionsPlayedByUser.get(pote.id) ?? 0;
            const gamesOwned = gamesOwnedByUser.get(pote.id) ?? 0;
            const steamActivityLabel = formatSteamActivityLabel(
              pote.lastPlayedGame,
              pote.lastPlayedAt,
              now
            );
            const nowPlaying = nowPlayingEnabled
              ? activeNowPlaying(pote.steamNowPlaying, pote.steamNowPlayingSeenAt, now)
              : null;
            return (
              <StaggerItem key={pote.id}>
                <Link href={`/potes/${pote.id}`}>
                  <div
                    className="card-glow overflow-hidden rounded-xl border-2 border-border bg-surface transition-all duration-200"
                    style={{ borderColor: `color-mix(in srgb, ${pote.color} 45%, var(--border))` }}
                  >
                    <div className="relative">
                      <BannerImage
                        url={pote.bannerUrl}
                        color={pote.color}
                        className="h-24 w-full sm:h-28"
                      />
                      <div className="absolute -bottom-8 left-4">
                        <div className="relative" style={{ width: 64, height: 64 }}>
                          <Avatar
                            src={pote.discordAvatar}
                            alt={pote.discordName}
                            size={64}
                            className={`ring-4 ring-offset-2 ring-offset-surface ${rank.ringClass}`}
                          />
                          <span className="pointer-events-none absolute -bottom-1 -right-1 flex h-6 min-w-6 items-center justify-center rounded-full border-2 border-surface bg-accent px-1 text-[11px] font-bold text-accent-foreground">
                            {level}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3 p-4 pt-10">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 truncate font-medium text-foreground">
                          <span className="truncate">{pote.discordName}</span>
                          <ColorDot color={pote.color} />
                          {levelByPote.get(levelKey(pote.id, levelFilter.gameId ?? "")) && (
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">Niveau {GAME_LEVEL_LABELS[levelByPote.get(levelKey(pote.id, levelFilter.gameId ?? ""))!]}</span>
                          )}
                          {activeDebtorIds.has(pote.id) && (
                            <span title="Dette de gage active">💀</span>
                          )}
                        </p>
                        <span
                          className={`rank-badge-shimmer mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${rank.colorClass}`}
                        >
                          {rank.name}
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <QuickStat
                          value={sessionsPlayed}
                          label={plural(sessionsPlayed, "soirée")}
                        />
                        <QuickStat value={pote.xpTotal} label="XP" />
                        <QuickStat
                          value={
                            pote.streakCount > 0 ? (
                              <span className="flex items-center gap-1">
                                {pote.streakCount}
                                <StreakFlame />
                              </span>
                            ) : (
                              pote.streakCount
                            )
                          }
                          label="série"
                        />
                        <QuickStat value={`🎮 ${gamesOwned}`} label="jeux" />
                      </div>

                      <Badge tone={pote.steamId64 ? "accent" : "neutral"} className="w-fit">
                        {pote.steamId64 ? "Steam lié" : "Steam non lié"}
                      </Badge>

                      {pote.steamId64 && nowPlaying && <NowPlayingBadge game={nowPlaying} />}

                      {pote.steamId64 && !nowPlaying && steamActivityLabel && (
                        <p className="text-xs text-muted">🎮 {steamActivityLabel}</p>
                      )}

                      {pote.userTags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {pote.userTags.map(({ tag }) => (
                            <span
                              key={tag.id}
                              className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                              style={{
                                backgroundColor: `color-mix(in srgb, ${tagColor(tag.name)} 18%, transparent)`,
                                color: tagColor(tag.name),
                              }}
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              </StaggerItem>
            );
          })}
        </Stagger>
      )}
    </div>
    </PullToRefresh>
  );
}
