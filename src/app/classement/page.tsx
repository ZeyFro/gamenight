import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { requireCommunityChosen } from "@/lib/community-picker";
import { getScoreboardCommunityId } from "@/lib/community-access";
import {
  getScoreboard,
  SCOREBOARD_PERIODS,
  type ScoreboardEntry,
  type ScoreboardPeriod,
} from "@/lib/scoreboard";
import { RankAvatar } from "@/components/RankAvatar";
import { ColorDot } from "@/components/ColorDot";
import { PodiumSpot } from "@/components/PodiumSpot";
import { PodiumConfetti } from "@/components/PodiumConfetti";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Stagger, StaggerItem } from "@/components/motion";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { pageMetadata } from "@/lib/page-title";

export const metadata = pageMetadata("Classement");

const PERIOD_LABELS: Record<ScoreboardPeriod, string> = {
  global: "Global",
  month: "Ce mois",
  week: "Cette semaine",
};

function isScoreboardPeriod(value: string | undefined): value is ScoreboardPeriod {
  return !!value && (SCOREBOARD_PERIODS as readonly string[]).includes(value);
}

/**
 * Flèche de delta de position (amélioration classement) — `null`/`0`
 * rendus différemment : `null` (périodes non-globales) n'affiche rien du
 * tout plutôt qu'un "=" qui laisserait croire à une vraie mesure de
 * stabilité sur une fenêtre qui vient de se réinitialiser.
 */
function PositionDelta({ delta }: { delta: number | null }) {
  if (delta === null) return null;
  if (delta === 0) {
    return <span className="text-xs text-faint" title="Position stable depuis 7 jours">=</span>;
  }
  const up = delta > 0;
  return (
    <span
      className={`text-xs font-medium ${up ? "text-emerald-400" : "text-destructive"}`}
      title={`${up ? "+" : ""}${delta} place${Math.abs(delta) > 1 ? "s" : ""} depuis 7 jours`}
    >
      {up ? "↑" : "↓"}
      {Math.abs(delta)}
    </span>
  );
}

function ScoreboardRow({
  entry,
  position,
  isMe,
}: {
  entry: ScoreboardEntry;
  position: number;
  isMe: boolean;
}) {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-center gap-4">
        <span className="flex w-6 shrink-0 flex-col items-center gap-0.5 text-center text-sm font-semibold tabular-nums text-muted">
          {position}
          <PositionDelta delta={entry.weekDeltaPosition} />
        </span>
        <RankAvatar
          src={entry.discordAvatar}
          alt={entry.discordName}
          level={entry.level}
          rank={entry.rank}
          size={44}
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate font-medium text-foreground">
            <span className="truncate">{entry.discordName}</span>
            <ColorDot color={entry.color} />
            {isMe && (
              <Badge tone="accent" className="shrink-0">
                Toi
              </Badge>
            )}
          </p>
          <p className="truncate text-xs text-muted">
            Niveau {entry.level} · {entry.title} · {entry.rank.name}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold tabular-nums text-foreground">{entry.periodXp} XP</p>
          <p className="text-xs tabular-nums text-muted">
            {entry.sessionsPlayed} soirée{entry.sessionsPlayed === 1 ? "" : "s"}
          </p>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.min(100, Math.max(0, entry.levelProgress * 100))}%` }}
        />
      </div>
    </Card>
  );
}

/**
 * Classement du groupe (`/classement`, PR 9/9 — dernière étape du chantier
 * XP/niveaux/rangs, cf. commentaires historiques sur `XpEvent`/`getGlobalRank`
 * qui réservaient explicitement cette page pour ici). Podium des 3
 * premiers en haut (mis en avant), tableau complet en dessous — le
 * podium reste dans la liste complète aussi (pas retiré des 3 premières
 * lignes) pour que se retrouver dans le classement reste un simple scan
 * de haut en bas, sans logique "en dehors du top 3" à comprendre.
 *
 * Filtre `?periode=` (même pattern query-param que `AdminTabs`) plutôt
 * qu'un état client : le classement est un rendu serveur simple, pas
 * besoin d'hydrater un composant client pour 3 boutons qui rechargent de
 * toute façon les données à chaque changement.
 */
export default async function ClassementPage({
  searchParams,
}: {
  searchParams: Promise<{ periode?: string; communaute?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  await requireCommunityChosen(user.id, "/classement");

  const { periode, communaute } = await searchParams;
  const period: ScoreboardPeriod = isScoreboardPeriod(periode) ? periode : "global";

  // Multi-communautés (PR4) : classement des membres d'UNE communauté
  // (`?communaute=<id>`, 404 si non membre ; sinon la communauté active).
  // `undefined` quand l'isolation est éteinte : tous les utilisateurs, comme avant.
  const communityId = await getScoreboardCommunityId(user.id, communaute);
  const entries = await getScoreboard(period, { communityId });
  const podium = entries.slice(0, 3);
  const [first, second, third] = podium;

  return (
    <PullToRefresh>
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          🏆 Classement
        </h1>
        <p className="mt-1 text-sm text-muted">Qui domine le groupe.</p>
      </div>

      <div className="lg:w-fit">
        <SegmentedControl
          groupId="classement-periode"
          activeKey={period}
          options={SCOREBOARD_PERIODS.map((p) => ({
            key: p,
            label: PERIOD_LABELS[p],
            href: `/classement?periode=${p}`,
          }))}
        />
      </div>

      {entries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Personne dans le groupe pour l&apos;instant.</p>
        </Card>
      ) : (
        // Podium à gauche, liste complète à droite sur desktop — le podium
        // reste "sticky" visuellement en haut de sa colonne pendant qu'on
        // scrolle la liste complète.
        <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,320px)_1fr] lg:items-start">
          {podium.length > 0 && (
            <div className="podium-glow-bg relative flex items-end justify-center gap-3 rounded-2xl p-4 sm:gap-6 lg:sticky lg:top-4">
              <PodiumConfetti />
              {second && <PodiumSpot entry={second} place={2} />}
              {first && <PodiumSpot entry={first} place={1} />}
              {third && <PodiumSpot entry={third} place={3} />}
            </div>
          )}

          <Stagger className="flex flex-col gap-3">
            {entries.map((entry, index) => (
              <StaggerItem key={entry.userId}>
                <ScoreboardRow
                  entry={entry}
                  position={index + 1}
                  isMe={entry.userId === user.id}
                />
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      )}
    </div>
    </PullToRefresh>
  );
}
