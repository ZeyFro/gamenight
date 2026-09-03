import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { levelForXp, rankForLevel } from "@/lib/xp";
import { bannerFallbackStyle } from "@/lib/user-color";
import { getActiveDebtorIds } from "@/lib/debts";
import { tagColor } from "@/lib/tags";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { ColorDot } from "@/components/ColorDot";
import { StreakFlame } from "@/components/StreakFlame";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Stagger, StaggerItem } from "@/components/motion";

function QuickStat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-0.5 rounded-lg bg-background px-2 py-2 text-center">
      <span className="text-sm font-bold text-foreground">{value}</span>
      <span className="text-[10px] text-muted">{label}</span>
    </div>
  );
}

export default async function PotesPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const potes = await prisma.user.findMany({
    where: { id: { not: user.id } },
    orderBy: { discordName: "asc" },
    select: {
      id: true,
      discordName: true,
      discordAvatar: true,
      color: true,
      bannerUrl: true,
      xpTotal: true,
      streakCount: true,
      steamId64: true,
      // Sprint 3 (FEATURE 6) — chips de tags sur la carte pote.
      userTags: { select: { tag: { select: { id: true, name: true } } } },
    },
  });

  // Une seule requête groupée pour "soirées jouées" plutôt que N requêtes
  // (une par pote) — même info que `getProfileStats`, mais cette page a
  // besoin de toutes les cartes d'un coup.
  const sessionsPlayedRows = await prisma.xpEvent.groupBy({
    by: ["userId"],
    where: { userId: { in: potes.map((p) => p.id) }, reason: "PARTICIPATE" },
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
  const activeDebtorIds = await getActiveDebtorIds();

  return (
    <PullToRefresh>
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12 lg:max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground sm:text-2xl">Potes</h1>
        <p className="mt-1 text-sm text-muted">
          {potes.length} membre{potes.length === 1 ? "" : "s"} dans le groupe.
        </p>
      </div>

      {potes.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">Personne d&apos;autre n&apos;a encore rejoint le groupe.</p>
        </Card>
      ) : (
        <Stagger className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {potes.map((pote) => {
            const level = levelForXp(pote.xpTotal);
            const rank = rankForLevel(level);
            const sessionsPlayed = sessionsPlayedByUser.get(pote.id) ?? 0;
            const gamesOwned = gamesOwnedByUser.get(pote.id) ?? 0;
            return (
              <StaggerItem key={pote.id}>
                <Link href={`/potes/${pote.id}`}>
                  <div
                    className="card-glow overflow-hidden rounded-xl border-2 border-border bg-surface transition-all duration-200"
                    style={{ borderColor: `color-mix(in srgb, ${pote.color} 45%, var(--border))` }}
                  >
                    <div className="relative">
                      <div
                        className="h-24 w-full sm:h-28"
                        style={
                          pote.bannerUrl
                            ? {
                                backgroundImage: `url(${pote.bannerUrl})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }
                            : bannerFallbackStyle(pote.color)
                        }
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
                          {activeDebtorIds.has(pote.id) && (
                            <span title="Dette de gage active">💀</span>
                          )}
                        </p>
                        <span
                          className={`mt-1 inline-block rounded-full px-2.5 py-0.5 text-[11px] font-medium ${rank.colorClass}`}
                        >
                          {rank.name}
                        </span>
                      </div>

                      <div className="flex gap-2">
                        <QuickStat
                          value={sessionsPlayed}
                          label={`soirée${sessionsPlayed === 1 ? "" : "s"}`}
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
                          label="streak"
                        />
                        <QuickStat value={`🎮 ${gamesOwned}`} label="jeux" />
                      </div>

                      <Badge tone={pote.steamId64 ? "accent" : "neutral"} className="w-fit">
                        {pote.steamId64 ? "Steam lié" : "Steam non lié"}
                      </Badge>

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
