import type { CommunityChannelCategory } from "@prisma/client";
import Link from "next/link";
import { listAdminCommunities, ADMIN_CHANNEL_CATEGORIES, type AdminCommunityRow } from "@/lib/community-admin";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { activateCommunityAction, setCommunityChannelAction, setCommunityGuideAction, setCommunityFreeGamesAction, setCommunitySteamPriceAlertsAction, setCommunityGroupPurchasePlansAction } from "@/app/admin/communautes/actions";
import { THREAD_CAPABLE_CHANNEL_TYPES, VOICE_CHANNEL_TYPES } from "@/lib/discord-rest";

const STATUS_LABELS: Record<string, { label: string; tone: "accent" | "neutral" | "warning" | "destructive" }> = {
  PENDING: { label: "En attente", tone: "warning" },
  ACTIVE: { label: "Active", tone: "accent" },
  SUSPENDED: { label: "Suspendue", tone: "destructive" },
  LEFT: { label: "Bot parti", tone: "neutral" },
  ARCHIVED: { label: "Archivée", tone: "neutral" },
};

const CATEGORY_LABELS: Record<CommunityChannelCategory, string> = {
  SESSION: "Salon des soirées",
  TOURNAMENT: "Salon des tournois",
  VOICE: "Salon vocal",
};

/** Messages du retour d'action (`?r=`), codes produits par `src/app/admin/communautes/actions.ts`. */
const RESULT_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  "activate-activated": { ok: true, text: "Communauté activée." },
  "activate-not_found": { ok: false, text: "Communauté introuvable." },
  "activate-not_pending": { ok: false, text: "Cette communauté n'est plus en attente." },
  "activate-no_guild": { ok: false, text: "Aucun serveur Discord connu pour cette communauté." },
  "channel-ok": { ok: true, text: "Salon enregistré." },
  "guide-ok": { ok: true, text: "Règles et contacts enregistrés." },
  "free-games-ok": { ok: true, text: "Configuration des jeux gratuits enregistrée." },
  "free-games-unavailable": { ok: false, text: "Seule une communauté active peut activer cette fonction." },
  "free-games-invalid": { ok: false, text: "Demande invalide." },
  "price-alerts-ok": { ok: true, text: "Alertes Steam enregistrées." },
  "price-alerts-invalid": { ok: false, text: "Le seuil doit être un pourcentage entier de 5 à 80." },
  "price-alerts-unavailable": { ok: false, text: "Cette communauté ne peut plus être modifiée." },
  "guide-invalid": { ok: false, text: "Les règles (4 000 caractères) ou les contacts (2 000 caractères) dépassent la limite." },
  "guide-unavailable": { ok: false, text: "Cette communauté n'est plus modifiable." },
  "purchase-plan-ok": { ok: true, text: "Plans d'achat collectif mis à jour." },
  "purchase-plan-invalid": { ok: false, text: "Demande invalide." },
  "purchase-plan-unavailable": { ok: false, text: "Cette communauté n'est plus modifiable." },
  "channel-invalid_channel": { ok: false, text: "Identifiant de salon invalide." },
  "channel-not_found": { ok: false, text: "Communauté introuvable." },
  "channel-inactive": { ok: false, text: "Cette communauté ne peut plus recevoir de salon." },
  "channel-no_guild": { ok: false, text: "Aucun serveur Discord connu pour cette communauté." },
  "channel-unusable_channel": {
    ok: false,
    text: "Ce salon n'appartient pas au serveur de la communauté, ou son type n'est pas utilisable.",
  },
  "channel-verification_failed": { ok: false, text: "Discord n'a pas pu confirmer ce salon : rien n'a été enregistré." },
  invalid: { ok: false, text: "Demande invalide." },
  rate: { ok: false, text: "Trop de demandes, réessaie dans une minute." },
};

const SELECT_CLASS =
  "rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export async function CommunitiesTab({ result }: { result?: string }) {
  const communities = await listAdminCommunities();
  const message = result ? RESULT_MESSAGES[result] : undefined;

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted">
        Active une communauté en attente et choisis les salons d&apos;annonce et le salon vocal. Un
        salon n&apos;est enregistré que s&apos;il appartient au serveur de la communauté (vérifié auprès de Discord).
      </p>

      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-accent" : "text-destructive"}`}>
          {message.text}
        </p>
      )}

      {communities.map((c) => (
        <CommunityCard key={c.id} community={c} />
      ))}
      {communities.length === 0 && <p className="text-sm text-muted">Aucune communauté.</p>}
    </div>
  );
}

function CommunityCard({ community: c }: { community: AdminCommunityRow }) {
  const status = STATUS_LABELS[c.status] ?? { label: c.status, tone: "neutral" as const };
  const editable = c.status === "PENDING" || c.status === "ACTIVE";

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-foreground">{c.name}</h2>
          <p className="text-xs text-muted">
            {c.slug} · serveur {c.discordGuildId ?? "inconnu"} · {c.activeMembers} membre
            {c.activeMembers > 1 ? "s" : ""}
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      {c.status === "PENDING" && (
        <form action={activateCommunityAction}>
          <input type="hidden" name="communityId" value={c.id} />
          <Button type="submit" variant="primary" size="sm" disabled={!c.discordGuildId}>
            Activer la communauté
          </Button>
        </form>
      )}

      {c.status === "ACTIVE" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <form action={setCommunityFreeGamesAction} className="flex items-center gap-3">
            <input type="hidden" name="communityId" value={c.id} />
            <input type="hidden" name="enabled" value={String(!c.freeGamesEnabled)} />
            <p className="text-sm text-muted">Jeux gratuits en français : {c.freeGamesEnabled ? "activés" : "désactivés"} (sélection manuelle).</p>
            <Button type="submit" size="sm">{c.freeGamesEnabled ? "Désactiver" : "Activer"}</Button>
          </form>
          <Link href={`/admin/jeux-gratuits?communityId=${encodeURIComponent(c.id)}`} className="text-sm font-medium text-accent">Gérer les offres →</Link>
        </div>
      )}

      {editable && (
        <form action={setCommunitySteamPriceAlertsAction} className="flex flex-col gap-3 border-t border-border pt-4">
          <input type="hidden" name="communityId" value={c.id} />
          <p className="text-sm font-medium text-foreground">Alertes de baisse de prix Steam</p>
          <p className="text-xs text-muted">Notifications uniquement dans GameNight. Vérification périodique des wishlists (France); une même entrée ne renotifie pas avant 7 jours.</p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="enabled" value="true" defaultChecked={c.steamPriceAlertsEnabled} className="h-5 w-5 accent-accent" />
            Activer les alertes pour cette communauté
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">Seuil de réduction (%)
            <input type="number" name="threshold" min={5} max={80} step={1} required defaultValue={c.steamPriceAlertThreshold} className={SELECT_CLASS} />
          </label>
          <Button type="submit" size="sm" className="self-start">Enregistrer les alertes</Button>
        </form>
      )}

      {editable && (
        <form action={setCommunityGuideAction} className="flex flex-col gap-2 border-t border-border pt-4">
          <input type="hidden" name="communityId" value={c.id} />
          <label className="text-sm font-medium" htmlFor={`${c.id}-guideRules`}>Règles du serveur</label>
          <textarea id={`${c.id}-guideRules`} name="guideRules" defaultValue={c.guideRules ?? ""} maxLength={4000} rows={4} className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
          <label className="text-sm font-medium" htmlFor={`${c.id}-guideContacts`}>Contacts et moyens de joindre les responsables</label>
          <textarea id={`${c.id}-guideContacts`} name="guideContacts" defaultValue={c.guideContacts ?? ""} maxLength={2000} rows={3} className="w-full rounded-lg border border-border bg-background p-3 text-sm" />
          <Button type="submit" size="sm">Enregistrer pour le guide</Button>
        </form>
      )}

      {editable && (
        <form action={setCommunityGroupPurchasePlansAction} className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <input type="hidden" name="communityId" value={c.id} />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">Plans d&apos;achat collectif</p>
            <p className="text-xs text-muted">Organisation indicative depuis la wishlist; aucun paiement ni achat automatique.</p>
          </div>
          <select name="enabled" defaultValue={String(c.groupPurchasePlansEnabled)} aria-label={`Plans d'achat collectif pour ${c.name}`} className={SELECT_CLASS}>
            <option value="false">Désactivés</option>
            <option value="true">Activés</option>
          </select>
          <Button type="submit" size="sm">Enregistrer</Button>
        </form>
      )}

      {editable &&
        ADMIN_CHANNEL_CATEGORIES.map((category) => {
          const current = c.channels[category];
          const channels = c.guildChannels?.filter((g) =>
            (category === "VOICE" ? VOICE_CHANNEL_TYPES : THREAD_CAPABLE_CHANNEL_TYPES).has(g.type)
          );
          const known = channels?.some((g) => g.id === current?.discordChannelId) ?? false;
          return (
            <form key={category} action={setCommunityChannelAction} className="flex flex-col gap-1">
              <input type="hidden" name="communityId" value={c.id} />
              <input type="hidden" name="category" value={category} />
              <label className="text-xs text-muted" htmlFor={`${c.id}-${category}`}>
                {CATEGORY_LABELS[category]}
                {current && !current.enabled ? " (désactivé)" : ""}
              </label>
              {channels ? (
                <div className="flex flex-wrap gap-2">
                  <select
                    id={`${c.id}-${category}`}
                    name="channelId"
                    defaultValue={known ? current?.discordChannelId : ""}
                    className={SELECT_CLASS}
                  >
                    <option value="" disabled>
                      {current && !known ? `Actuel : ${current.discordChannelId} (introuvable)` : "Choisir un salon"}
                    </option>
                    {channels.map((g) => (
                      <option key={g.id} value={g.id}>
                        #{g.name}
                      </option>
                    ))}
                  </select>
                  <Button type="submit" size="sm">
                    Enregistrer
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">
                  {c.channelsError ?? "Liste des salons indisponible."}
                  {current ? ` Salon actuel : ${current.discordChannelId}.` : ""}
                </p>
              )}
            </form>
          );
        })}
    </Card>
  );
}
