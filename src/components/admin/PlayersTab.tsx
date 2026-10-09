import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { XpAdjustForm } from "@/components/admin/XpAdjustForm";
import {
  getAdminCurrentCommunity,
  getAdminPlayerDetail,
  searchAdminPlayers,
  type AdminPlayerDetail,
} from "@/lib/admin-xp";
import { XP_REASON_LABELS } from "@/lib/xp-reason-labels";
import { formatDateTimeFr } from "@/lib/wallclock";
import type { XpReason } from "@prisma/client";

const FIELD_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

function signed(amount: number): string {
  return `${amount > 0 ? "+" : ""}${amount.toLocaleString("fr-FR")}`;
}

/**
 * Onglet « Joueurs » de /admin : chercher un membre par pseudo Discord, voir son XP,
 * son niveau, son rang et son historique récent, puis corriger son XP (remplacement
 * de la valeur, confirmation, journal). Limité à la communauté ACTUELLE de l'admin.
 * Recherche en GET (`?tab=joueurs&q=…&u=…`) : rien à gérer côté client avant la fiche.
 */
export async function PlayersTab({ adminId, query, playerId }: { adminId: string; query?: string; playerId?: string }) {
  const community = await getAdminCurrentCommunity(adminId);
  if (!community) {
    return (
      <p className="text-sm text-muted">
        Aucune communauté active pour ton compte : choisis un serveur depuis la page « Serveurs », puis reviens ici.
      </p>
    );
  }

  const q = (query ?? "").trim();
  const [results, detail] = await Promise.all([
    q ? searchAdminPlayers(community.id, q) : Promise.resolve([]),
    playerId ? getAdminPlayerDetail(community.id, playerId) : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Corrige l&apos;XP d&apos;un joueur de la communauté <strong className="text-foreground">{community.name}</strong>{" "}
        (ta communauté actuelle). Pour une autre communauté, change de serveur depuis la page « Serveurs ».
      </p>

      <form method="get" action="/admin" className="flex flex-col gap-2 sm:flex-row">
        <input type="hidden" name="tab" value="joueurs" />
        <label className="sr-only" htmlFor="joueurs-recherche">
          Pseudo Discord
        </label>
        <input
          id="joueurs-recherche"
          name="q"
          type="search"
          defaultValue={q}
          placeholder="Pseudo Discord du joueur"
          autoComplete="off"
          className={FIELD_CLASS}
        />
        <Button type="submit" variant="primary" fullWidthOnMobile>
          Chercher
        </Button>
      </form>

      {q && results.length === 0 && <p className="text-sm text-muted">Aucun joueur de cette communauté ne correspond.</p>}

      {results.length > 0 && (
        <ul className="flex flex-col gap-2">
          {results.map((player) => (
            <li key={player.id}>
              <Link
                href={`/admin?tab=joueurs&q=${encodeURIComponent(q)}&u=${player.id}`}
                className={`flex min-h-[44px] items-center gap-3 rounded-lg border px-3 py-2 transition-colors hover:border-accent ${
                  player.id === playerId ? "border-accent bg-accent/10" : "border-border bg-surface"
                }`}
              >
                <Avatar src={player.discordAvatar} alt={`Avatar de ${player.discordName}`} size={36} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{player.discordName}</span>
                <span className="shrink-0 text-xs text-muted">{player.xpTotal.toLocaleString("fr-FR")} XP</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {playerId && !detail && (
        <p className="text-sm text-muted">Ce joueur n&apos;est pas un membre actif de cette communauté.</p>
      )}
      {detail && <PlayerCard detail={detail} communityId={community.id} communityName={community.name} />}
    </div>
  );
}

function PlayerCard({ detail, communityId, communityName }: { detail: AdminPlayerDetail; communityId: string; communityName: string }) {
  return (
    <Card className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <Avatar src={detail.discordAvatar} alt={`Avatar de ${detail.discordName}`} size={48} />
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-foreground">{detail.discordName}</h2>
          <p className="text-sm text-muted">
            <span className="font-semibold text-accent">{detail.xpTotal.toLocaleString("fr-FR")} XP</span> · niveau{" "}
            {detail.level} · {detail.title} · {detail.rankName}
          </p>
        </div>
      </div>

      {detail.creations.paid > 0 && (
        <p className="text-sm text-muted">
          Soirées créées avec gain d&apos;XP : <strong className="text-foreground">{detail.creations.paid}</strong>, dont{" "}
          <strong className={detail.creations.deleted > 0 ? "text-warning" : "text-foreground"}>
            {detail.creations.deleted}
          </strong>{" "}
          supprimée{detail.creations.deleted > 1 ? "s" : ""} depuis.
        </p>
      )}

      <XpAdjustForm
        key={`${detail.id}-${detail.xpTotal}`}
        communityId={communityId}
        communityName={communityName}
        userId={detail.id}
        userName={detail.discordName}
        currentXp={detail.xpTotal}
      />

      <section aria-labelledby="xp-historique">
        <h3 id="xp-historique" className="text-sm font-semibold text-foreground">
          Derniers gains
        </h3>
        {detail.recentEvents.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Aucun gain enregistré.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {detail.recentEvents.map((event) => (
              <li key={event.id} className="flex items-center gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-foreground">
                    {XP_REASON_LABELS[event.reason as XpReason] ?? event.reason}
                    {event.sessionDeleted && (
                      <Badge tone="warning" className="ml-2 align-middle">
                        soirée supprimée
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-muted">{formatDateTimeFr(event.createdAt)}</p>
                </div>
                <span className={`shrink-0 font-medium ${event.amount < 0 ? "text-destructive" : "text-foreground"}`}>
                  {signed(event.amount)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {detail.adjustments.length > 0 && (
        <section aria-labelledby="xp-corrections">
          <h3 id="xp-corrections" className="text-sm font-semibold text-foreground">
            Corrections précédentes
          </h3>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {detail.adjustments.map((adjustment) => (
              <li key={adjustment.id} className="py-2 text-sm">
                <p className="text-foreground">
                  {adjustment.oldXp.toLocaleString("fr-FR")} → {adjustment.newXp.toLocaleString("fr-FR")} XP, par{" "}
                  {adjustment.adminName}
                </p>
                <p className="text-xs text-muted">
                  {formatDateTimeFr(adjustment.createdAt)}
                  {adjustment.reason ? ` · ${adjustment.reason}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </Card>
  );
}
