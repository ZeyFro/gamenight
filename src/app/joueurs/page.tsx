import { parsePlayerClassifiedFilters, type PlayerClassifiedSearchParams } from "@/lib/player-classified-filters";
import { PLAYER_PLATFORMS } from "@/lib/player-equipment";
import { PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS, PLAYER_CLASSIFIED_PARTY_TYPES } from "@/lib/player-classifieds-rules";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { getPlayerClassifiedCommunityId, listPlayerClassifieds } from "@/lib/player-classifieds";
import { formatDateTimeFr, formatDurationFr, wallClockNow } from "@/lib/wallclock";
import { isAdminUser, parseAdminDiscordIds } from "@/lib/admin-rules";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { createPlayerClassifiedAction, deletePlayerClassifiedAction } from "./actions";
import { pageMetadata } from "@/lib/page-title";
import { isTonightEnabled } from "@/lib/tonight-rules";

export const metadata = pageMetadata("Chercher un joueur");

const ERRORS: Record<string, string> = {
  unavailable: "Les annonces ne sont pas disponibles dans ta communauté.",
  invalid: "Choisis un jeu, écris un message de 1 à 240 caractères et vérifie les champs de matchmaking.",
  forbidden: "Tu ne peux supprimer que tes annonces, sauf si tu es admin.",
  rate_limited: "Trop de demandes, réessaie dans une minute.",
};

export default async function PlayerClassifiedsPage({
  searchParams,
}: {
  searchParams: Promise<PlayerClassifiedSearchParams>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const communityId = await getPlayerClassifiedCommunityId(user.id);
  if (!communityId) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-8 sm:px-6 sm:py-12">
        <h1 className="text-xl font-semibold text-foreground">🔎 Chercher un joueur</h1>
        <Card className="text-sm text-muted">Les annonces ne sont pas disponibles dans ta communauté.</Card>
        <Link href="/jouer-maintenant" className="text-sm font-medium text-accent">Jouer maintenant →</Link>
        <Link href="/equipes" className="text-sm font-medium text-accent">Créer une équipe durable →</Link>
      </main>
    );
  }

  const params = await searchParams;
  const { error } = params;
  const parsedFilters = parsePlayerClassifiedFilters(params);
  const filters = parsedFilters.success ? parsedFilters.data : {};
  const [games, listings] = await Promise.all([
    prisma.game.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    parsedFilters.success ? listPlayerClassifieds(user.id, communityId, wallClockNow(), filters) : Promise.resolve([]),
  ]);
  const admin = isAdminUser(user, parseAdminDiscordIds(process.env.ADMIN_DISCORD_IDS));

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground sm:text-2xl">🔎 Chercher un joueur</h1>
          <p className="mt-1 text-sm text-muted">Annonces visibles par les membres actifs de ta communauté. Elles expirent après 24 h.</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {isTonightEnabled() && <Link href="/ce-soir" className="text-sm font-medium text-accent">Qui joue ce soir ? →</Link>}
          <Link href="/jouer-maintenant" className="text-sm font-medium text-accent">Jouer maintenant →</Link>
        </div>
      </div>

      {typeof error === "string" && ERRORS[error] && <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{ERRORS[error]}</p>}

      <Card>
        <form action={createPlayerClassifiedAction} className="flex flex-col gap-3">
          <label htmlFor="classified-game" className="text-sm font-medium text-foreground">Jeu</label>
          <select id="classified-game" name="gameId" required className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground">
            <option value="">Choisir un jeu</option>
            {games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
          </select>
          <label htmlFor="classified-message" className="text-sm font-medium text-foreground">Ton annonce</label>
          <input id="classified-message" name="message" required maxLength={240} placeholder="Il nous manque un joueur pour ce soir…" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" />
          <label htmlFor="classified-platform" className="text-sm font-medium text-foreground">Plateforme de la partie (facultatif)</label>
          <select id="classified-platform" name="platform" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground">
            <option value="">À préciser</option>
            {PLAYER_PLATFORMS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <label htmlFor="classified-party-type" className="text-sm font-medium text-foreground">Type de partie (facultatif)</label>
          <select id="classified-party-type" name="partyType" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground">
            <option value="">À préciser</option>
            {PLAYER_CLASSIFIED_PARTY_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label htmlFor="classified-microphone" className="text-sm font-medium text-foreground">Micro pour cette partie (facultatif)</label>
          <select id="classified-microphone" name="microphoneRequirement" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground">
            <option value="">À préciser</option>
            {PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium text-foreground">Horaire proposé (facultatif, heure de Paris)</legend>
            <label htmlFor="classified-start-date" className="text-xs text-muted">Date</label>
            <input id="classified-start-date" name="startsDate" type="date" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" />
            <label htmlFor="classified-start-time" className="text-xs text-muted">Heure</label>
            <input id="classified-start-time" name="startsTime" type="time" step={60} className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" />
            <label htmlFor="classified-duration" className="text-xs text-muted">Durée en minutes (1 à 10 080)</label>
            <input id="classified-duration" name="durationMinutes" type="number" min={1} max={10080} step={1} className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" />
            <p className="text-xs text-muted">La date, l’heure et la durée doivent être renseignées ensemble. L’horaire est affiché comme heure murale de Paris.</p>
          </fieldset>
          <Button type="submit" variant="primary">Publier pendant 24 h</Button>
        </form>
      </Card>

      <Card>
        <form action="/joueurs" method="get" className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Filtrer les annonces</h2>
          <label htmlFor="filter-game">Jeu recherché</label>
          <select id="filter-game" name="gameId" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" defaultValue={filters.gameId ?? ""}>
            <option value="">Tous les jeux</option>
            {games.map(game => <option key={game.id} value={game.id}>{game.name}</option>)}
          </select>
          <label htmlFor="filter-platform">Plateforme déclarée du joueur</label>
          <select id="filter-platform" name="platform" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" defaultValue={filters.platform ?? ""}>
            <option value="">Toutes les plateformes</option>
            {PLAYER_PLATFORMS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <label htmlFor="filter-microphone">Micro du joueur</label>
          <select id="filter-microphone" name="microphone" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" defaultValue={filters.microphone ?? ""}>
            <option value="">Tous</option>
            <option value="yes">Disponible</option>
            <option value="no">Non disponible</option>
            <option value="unknown">Non renseigné</option>
          </select>
          <label htmlFor="filter-party-platform">Plateforme de la partie</label>
          <select id="filter-party-platform" name="partyPlatform" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" defaultValue={filters.partyPlatform ?? ""}>
            <option value="">Toutes les plateformes</option>
            {PLAYER_PLATFORMS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <label htmlFor="filter-microphone-requirement">Micro demandé</label>
          <select id="filter-microphone-requirement" name="microphoneRequirement" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" defaultValue={filters.microphoneRequirement ?? ""}>
            <option value="">Tous</option>
            {PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <label htmlFor="filter-party-type">Type de partie</label>
          <select id="filter-party-type" name="partyType" className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground" defaultValue={filters.partyType ?? ""}>
            <option value="">Tous</option>
            {PLAYER_CLASSIFIED_PARTY_TYPES.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
          <fieldset className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <legend className="px-1 text-sm font-medium">Horaire de la partie (heure de Paris)</legend>
            <label htmlFor="filter-starts-after-date" className="text-xs text-muted">À partir du</label>
            <div className="grid grid-cols-2 gap-2">
              <input id="filter-starts-after-date" name="startsAfterDate" type="date" aria-label="À partir de la date" defaultValue={filters.startsAfterDate ?? ""} className="min-w-0 rounded-lg border border-border bg-background px-2 py-3 text-sm text-foreground" />
              <input name="startsAfterTime" type="time" step={60} aria-label="À partir de l’heure" defaultValue={filters.startsAfterTime ?? ""} className="min-w-0 rounded-lg border border-border bg-background px-2 py-3 text-sm text-foreground" />
            </div>
            <label htmlFor="filter-starts-before-date" className="text-xs text-muted">Jusqu’au</label>
            <div className="grid grid-cols-2 gap-2">
              <input id="filter-starts-before-date" name="startsBeforeDate" type="date" aria-label="Jusqu’à la date" defaultValue={filters.startsBeforeDate ?? ""} className="min-w-0 rounded-lg border border-border bg-background px-2 py-3 text-sm text-foreground" />
              <input name="startsBeforeTime" type="time" step={60} aria-label="Jusqu’à l’heure" defaultValue={filters.startsBeforeTime ?? ""} className="min-w-0 rounded-lg border border-border bg-background px-2 py-3 text-sm text-foreground" />
            </div>
            <p className="text-xs text-muted">Pour chaque borne, renseigne ensemble la date et l’heure.</p>
          </fieldset>
          <p className="text-xs text-muted">Informations déclarées dans les profils. Elles ne garantissent pas la compatibilité cross-play.</p>
          <Button type="submit">Filtrer</Button>
          <Link href="/joueurs">Réinitialiser les filtres</Link>
        </form>
      </Card>
      {!parsedFilters.success && <p role="alert">Les filtres sont invalides. Réinitialise-les pour voir les annonces.</p>}
      <section className="flex flex-col gap-3" aria-labelledby="classified-list-title">
        <h2 id="classified-list-title" className="text-sm font-medium text-foreground">Annonces récentes ({listings.length})</h2>
        {listings.length === 0 ? <EmptyState icon="🎮" title={Object.values(filters).some(Boolean) || !parsedFilters.success ? "Aucune annonce ne correspond aux filtres." : "Aucune annonce en cours."} /> : (
          <ul className="flex flex-col gap-2">
            {listings.map((listing) => (
              <li key={listing.id}>
                <Card className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{listing.game.name}</p>
                      <p className="text-xs text-muted">Par {listing.createdBy.discordName}</p>
                    </div>
                    {(listing.createdBy.id === user.id || admin) && (
                      <form action={deletePlayerClassifiedAction}>
                        <input type="hidden" name="id" value={listing.id} />
                        <button type="submit" className="text-xs text-destructive underline">Supprimer</button>
                      </form>
                    )}
                  </div>
                  <p className="text-sm text-foreground">{listing.message}</p>
                  {(listing.platform || listing.microphoneRequirement || listing.partyType) && (
                    <p className="text-xs text-muted">
                      {listing.platform && PLAYER_PLATFORMS.find(option => option.key === listing.platform)?.label}
                      {listing.partyType && ` · ${PLAYER_CLASSIFIED_PARTY_TYPES.find(option => option.value === listing.partyType)?.label}`}
                      {listing.microphoneRequirement && ` · ${PLAYER_CLASSIFIED_MICROPHONE_REQUIREMENTS.find(option => option.value === listing.microphoneRequirement)?.label}`}
                    </p>
                  )}
                  {listing.startsAt && listing.durationMinutes && (
                    <p className="text-xs text-muted">{formatDateTimeFr(listing.startsAt)} · {formatDurationFr(listing.durationMinutes * 60_000)}</p>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
