import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { levelForXp, rankForLevel, titleForLevel, xpForLevel } from "@/lib/xp";
import { getGlobalRank, getProfileStats } from "@/lib/profile-stats";
import { bannerFallbackStyle } from "@/lib/user-color";
import { formatDurationFr, nowMs } from "@/lib/wallclock";
import { RankAvatar } from "@/components/RankAvatar";
import { ColorDot } from "@/components/ColorDot";
import { ProfilTabs } from "@/components/ProfilTabs";
import { CopyProfileLinkButton } from "@/components/CopyProfileLinkButton";
import { StreakFlame } from "@/components/StreakFlame";
import { ButtonLink } from "@/components/ui/Button";
import { CountUp } from "@/components/ui/CountUp";

function formatMemberSince(date: Date): string {
  return new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" }).format(date);
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface p-3 text-center">
      <CountUp value={value} className="text-xl font-bold tabular-nums text-foreground" />
      <span className="text-[11px] text-muted">{label}</span>
    </div>
  );
}

function StreakStatCard({ value }: { value: number }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl border border-border bg-surface p-3 text-center">
      <span className="flex items-center gap-1 text-xl font-bold tabular-nums text-foreground">
        <CountUp value={value} />
        {value > 0 && <StreakFlame />}
      </span>
      <span className="text-[11px] text-muted">Streak</span>
    </div>
  );
}

/**
 * En-tête profil rich (PR 8/9, refonte inspirée de mangas-origines.fr) —
 * bannière + avatar à anneau coloré par rang + stats en cartes + onglets,
 * partagés par les 6 sous-routes de `/profil`.
 *
 * Bannière en `background-image` CSS plutôt que `next/image` : `bannerUrl`
 * est une URL externe arbitraire saisie par l'utilisateur (voir
 * `/profil/parametres` et le README pour la décision "URL uniquement,
 * pas d'upload") — `next/image` exige une liste blanche de domaines dans
 * `next.config.ts`, ce qu'on ne peut pas maintenir pour une URL
 * complètement libre. Une balise CSS classique n'a pas cette contrainte
 * et gère nativement le "cover center" demandé pour tolérer d'autres
 * ratios que 1500×500.
 */
export default async function ProfilLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const level = levelForXp(user.xpTotal);
  const rank = rankForLevel(level);
  const title = titleForLevel(level);
  const xpIntoLevel = user.xpTotal - xpForLevel(level);
  const xpForNextLevel = xpForLevel(level + 1) - xpForLevel(level);

  const [stats, globalRank] = await Promise.all([
    getProfileStats(user.id, user.streakCount),
    getGlobalRank(user.id, user.xpTotal),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 pb-8 sm:pb-12">
      <div className="relative">
        <div
          className="h-40 w-full sm:h-56 md:h-64"
          style={
            user.bannerUrl
              ? {
                  backgroundImage: `url(${user.bannerUrl})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }
              : bannerFallbackStyle(user.color)
          }
        />
        <div className="absolute right-4 top-4 flex max-w-[calc(100%-2rem)] flex-wrap justify-end gap-2">
          <CopyProfileLinkButton userId={user.id} />
          <ButtonLink href="/profil/parametres" variant="secondary" size="sm">
            ⚙️ Modifier
          </ButtonLink>
        </div>
      </div>

      <div className="flex flex-col gap-4 px-4 sm:px-6">
        <div className="-mt-16 flex items-end gap-4 sm:-mt-20">
          <RankAvatar src={user.discordAvatar} alt={user.discordName} level={level} rank={rank} size={96} />
          <div className="name-halo relative flex flex-1 flex-col gap-1 pb-1">
            <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground drop-shadow sm:text-2xl">
              {user.discordName}
              <ColorDot color={user.color} title="Ta couleur perso" />
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rank-badge-shimmer rounded-full px-3 py-1 text-xs font-medium ${rank.colorClass}`}
              >
                {rank.name}
              </span>
              <span className="text-xs text-muted">{title}</span>
            </div>
          </div>
        </div>

        <p className="text-xs text-muted">
          Membre depuis {formatMemberSince(user.createdAt)} ·{" "}
          <Link href="/classement" className="text-accent hover:underline">
            Rang global #{globalRank.position} sur {globalRank.total}
          </Link>
        </p>

        {/* Sprint 4 (FEATURE 4) — consultation passive, jamais de notif. */}
        {user.steamId64 && user.lastPlayedGame && user.lastPlayedAt && (
          <p className="text-xs text-muted">
            🎮 Joue à {user.lastPlayedGame} — il y a{" "}
            {formatDurationFr(nowMs() - user.lastPlayedAt.getTime())}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.min(100, (xpIntoLevel / xpForNextLevel) * 100)}%` }}
            />
          </div>
          <p className="text-xs tabular-nums text-muted">
            {user.xpTotal} XP au total — {xpIntoLevel} / {xpForNextLevel} vers le niveau{" "}
            {level + 1}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          <StatCard label="Soirées jouées" value={stats.sessionsParticipated} />
          <StatCard label="Jeux en biblio" value={stats.libraryCount} />
          <StatCard label="Soirées créées" value={stats.sessionsCreated} />
          <StatCard label="Récompenses gagnées" value={stats.superlativesWon} />
          <StreakStatCard value={stats.streakCount} />
        </div>

        <ProfilTabs />

        {children}
      </div>
    </div>
  );
}
