import type { CommunityChannelCategory } from "@prisma/client";
import { listAdminCommunities, ADMIN_CHANNEL_CATEGORIES, type AdminCommunityRow } from "@/lib/community-admin";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { activateCommunityAction, setCommunityChannelAction } from "@/app/admin/communautes/actions";

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
};

/** Messages du retour d'action (`?r=`), codes produits par `src/app/admin/communautes/actions.ts`. */
const RESULT_MESSAGES: Record<string, { ok: boolean; text: string }> = {
  "activate-activated": { ok: true, text: "Communauté activée." },
  "activate-not_found": { ok: false, text: "Communauté introuvable." },
  "activate-not_pending": { ok: false, text: "Cette communauté n'est plus en attente." },
  "activate-no_guild": { ok: false, text: "Aucun serveur Discord connu pour cette communauté." },
  "channel-ok": { ok: true, text: "Salon enregistré." },
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
        Active une communauté en attente et choisis les salons où GameNight annonce les soirées et les tournois. Un
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

      {editable &&
        ADMIN_CHANNEL_CATEGORIES.map((category) => {
          const current = c.channels[category];
          const known = c.guildChannels?.some((g) => g.id === current?.discordChannelId) ?? false;
          return (
            <form key={category} action={setCommunityChannelAction} className="flex flex-col gap-1">
              <input type="hidden" name="communityId" value={c.id} />
              <input type="hidden" name="category" value={category} />
              <label className="text-xs text-muted" htmlFor={`${c.id}-${category}`}>
                {CATEGORY_LABELS[category]}
                {current && !current.enabled ? " (désactivé)" : ""}
              </label>
              {c.guildChannels ? (
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
                    {c.guildChannels.map((g) => (
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
