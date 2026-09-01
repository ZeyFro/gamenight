import { RankAvatar } from "@/components/RankAvatar";
import { ColorDot } from "@/components/ColorDot";
import type { ScoreboardEntry } from "@/lib/scoreboard";

const PODIUM_CONFIG: Record<1 | 2 | 3, { avatarSize: number; pedestalHeight: string; medal: string }> = {
  1: { avatarSize: 88, pedestalHeight: "h-24", medal: "🥇" },
  2: { avatarSize: 64, pedestalHeight: "h-16", medal: "🥈" },
  3: { avatarSize: 64, pedestalHeight: "h-12", medal: "🥉" },
};

/**
 * Une marche du podium (`/classement`, réutilisé sur la home — refonte
 * "Classement rapide"). Extrait tel quel de `/classement/page.tsx` — même
 * rendu, comportement inchangé sur `/classement`.
 */
export function PodiumSpot({ entry, place }: { entry: ScoreboardEntry; place: 1 | 2 | 3 }) {
  const { avatarSize, pedestalHeight, medal } = PODIUM_CONFIG[place];

  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      <span className="text-2xl" aria-hidden>
        {medal}
      </span>
      <RankAvatar
        src={entry.discordAvatar}
        alt={entry.discordName}
        level={entry.level}
        rank={entry.rank}
        size={avatarSize}
      />
      <p className="flex w-full items-center justify-center gap-1.5 truncate text-center text-sm font-medium text-foreground">
        <span className="truncate">{entry.discordName}</span>
        <ColorDot color={entry.color} />
      </p>
      <p className="text-xs text-muted">{entry.periodXp} XP</p>
      <div className={`w-full rounded-t-xl bg-surface-hover ${pedestalHeight}`} />
    </div>
  );
}
