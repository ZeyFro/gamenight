import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import {
  getScoreboard,
  SCOREBOARD_PERIODS,
  type ScoreboardEntry,
  type ScoreboardPeriod,
} from "@/lib/scoreboard";
import { RankAvatar } from "@/components/RankAvatar";
import { ColorDot } from "@/components/ColorDot";
import { PodiumSpot } from "@/components/PodiumSpot";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Stagger, StaggerItem } from "@/components/motion";

const PERIOD_LABELS: Record<ScoreboardPeriod, string> = {
  global: "Global",
  month: "Ce mois",
  week: "Cette semaine",
};

function isScoreboardPeriod(value: string | undefined): value is ScoreboardPeriod {
  return !!value && (SCOREBOARD_PERIODS as readonly string[]).includes(value);
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
    <Card className="flex items-center gap-4">
      <span className="w-6 shrink-0 text-center text-sm font-semibold text-muted">
        {position}
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
        <p className="text-sm font-semibold text-foreground">{entry.periodXp} XP</p>
        <p className="text-xs text-muted">
          {entry.sessionsPlayed} soirée{entry.sessionsPlayed === 1 ? "" : "s"}
        </p>
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
  searchParams: Promise<{ periode?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { periode } = await searchParams;
  const period: ScoreboardPeriod = isScoreboardPeriod(periode) ? periode : "global";

  const entries = await getScoreboard(period);
  const podium = entries.slice(0, 3);
  const [first, second, third] = podium;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
          🏆 Classement
        </h1>
        <p className="mt-1 text-sm text-muted">Qui domine le groupe.</p>
      </div>

      <div className="flex gap-2 rounded-lg border border-border bg-background p-1">
        {SCOREBOARD_PERIODS.map((p) => (
          <Link
            key={p}
            href={`/classement?periode=${p}`}
            className={`flex-1 rounded-md px-3 py-2 text-center text-sm font-medium transition-colors ${
              period === p
                ? "bg-accent text-accent-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {PERIOD_LABELS[p]}
          </Link>
        ))}
      </div>

      {entries.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Personne dans le groupe pour l&apos;instant.</p>
        </Card>
      ) : (
        <>
          {podium.length > 0 && (
            <div className="flex items-end justify-center gap-3 sm:gap-6">
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
        </>
      )}
    </div>
  );
}
