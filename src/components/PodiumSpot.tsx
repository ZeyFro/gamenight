import { RankAvatar } from "@/components/RankAvatar";
import { ColorDot } from "@/components/ColorDot";
import type { ScoreboardEntry } from "@/lib/scoreboard";

const PODIUM_CONFIG: Record<
  1 | 2 | 3,
  { avatarSize: number; pedestalHeight: string; medal: string; glow: string }
> = {
  1: { avatarSize: 88, pedestalHeight: "h-24", medal: "🥇", glow: "#facc15" },
  2: { avatarSize: 64, pedestalHeight: "h-16", medal: "🥈", glow: "#cbd5e1" },
  3: { avatarSize: 64, pedestalHeight: "h-12", medal: "🥉", glow: "#d97706" },
};

/**
 * Une marche du podium (`/classement`, réutilisé sur la home — refonte
 * "Classement rapide"). Extrait tel quel de `/classement/page.tsx` — même
 * rendu, comportement inchangé sur `/classement`.
 *
 * Glow doré/argenté/bronze (design de fond) — dégradé radial flouté
 * derrière l'avatar, couleur par place, posé en `-z-10` sous
 * `RankAvatar` (jamais sur l'anneau lui-même, qui garde sa propre couleur
 * de rang — deux signaux différents : la place du podium vs le rang XP).
 */
export function PodiumSpot({ entry, place }: { entry: ScoreboardEntry; place: 1 | 2 | 3 }) {
  const { avatarSize, pedestalHeight, medal, glow } = PODIUM_CONFIG[place];

  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <span className="text-2xl" aria-hidden>
        {medal}
      </span>
      <div className="relative flex items-center justify-center">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 rounded-full blur-xl"
          style={{ background: `radial-gradient(circle, ${glow}66, transparent 70%)` }}
        />
        <RankAvatar
          src={entry.discordAvatar}
          alt={entry.discordName}
          level={entry.level}
          rank={entry.rank}
          size={avatarSize}
        />
      </div>
      <p className="flex w-full items-center justify-center gap-1.5 truncate text-center text-sm font-medium text-foreground">
        <span className="truncate">{entry.discordName}</span>
        <ColorDot color={entry.color} />
      </p>
      <p className="text-xs tabular-nums text-muted">{entry.periodXp} XP</p>
      <div className={`w-full rounded-t-xl bg-surface-hover ${pedestalHeight}`} />
    </div>
  );
}
