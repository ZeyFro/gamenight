import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { steamPrivacySettingsUrl } from "@/lib/steam";
import { reimportSteamLibrary } from "@/app/actions";
import { resyncSteamFamilyAction } from "@/app/profil/family-import-actions";
import { toggleSoundEnabled, updateNotificationPreferenceAction } from "@/app/profil/actions";
import { createTagAction, toggleUserTagAction } from "@/app/tags-actions";
import { prisma } from "@/lib/prisma";
import { tagColor } from "@/lib/tags";
import { formatDurationFr, nowMs } from "@/lib/wallclock";
import { Card } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { BannerForm } from "@/components/BannerForm";
import { ColorPickerField } from "@/components/ColorPickerField";
import { FamilyImportForm } from "@/components/FamilyImportForm";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import { CursorTrailToggle } from "@/components/CursorTrailToggle";
import { GamePreferencesForm } from "@/components/GamePreferencesForm";
import { visiblePreferenceGames } from "@/lib/game-suggestions";
import { PlayerEquipmentForm } from "@/components/PlayerEquipmentForm";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { GAMING_IDENTIFIER_FIELDS } from "@/lib/gaming-identifiers";
import { updateGamingIdentifiersAction } from "@/app/profil/gaming-identifiers-actions";
import {
  AVAILABLE_NOTIFICATION_CATEGORIES,
  getUserNotificationPreferences,
  NOTIFICATION_CATEGORY_DETAILS,
} from "@/lib/notification-preferences";
import { pageMetadata } from "@/lib/page-title";
import { resolveActiveCommunityId } from "@/lib/community-isolation";
import { saveGameStyleProfile } from "@/app/profil/game-style-actions";
import { WebPushSettings } from "@/components/WebPushSettings";
import { webPushConfig } from "@/lib/web-push-config";

export const metadata = pageMetadata("Paramètres");

/**
 * Onglet "Rappels perso" — en réalité tous les réglages de compte
 * (bannière, Steam, silence des rappels), pas seulement les rappels :
 * regroupés ici plutôt que dans une modal séparée pour le bouton
 * "Modifier" de l'en-tête, qui pointe directement vers cette route.
 */
const UPLOAD_FEEDBACK: Record<string, { text: string; className: string }> = {
  ok: { text: "Bannière mise à jour.", className: "bg-accent/10 text-accent" },
  erreur: { text: "Aucun fichier reçu, réessaie.", className: "bg-destructive/10 text-destructive" },
  "trop-lourd": {
    text: "Fichier trop lourd (5 Mo max).",
    className: "bg-destructive/10 text-destructive",
  },
  format: {
    text: "Format non supporté (jpg, png, webp ou gif uniquement).",
    className: "bg-destructive/10 text-destructive",
  },
  desactive: {
    text: "Upload désactivé : BLOB_READ_WRITE_TOKEN n'est pas configuré côté serveur. Contacte l'admin, ou utilise l'onglet URL.",
    className: "bg-warning/10 text-warning",
  },
  echec: {
    text: "Une erreur est survenue pendant l'enregistrement, réessaie.",
    className: "bg-destructive/10 text-destructive",
  },
};

/**
 * Fix bug remonté (Family re-sync) — messages du bouton "🔄
 * Resynchroniser Family". `resync_vide` ne veut PAS dire "erreur" : Steam
 * n'a simplement rien renvoyé de nouveau, cas attendu si le compte ne
 * partage pas ses jeux Family via l'API (limitation Steam, cf.
 * `resyncSteamFamilyAction`) — d'où le renvoi explicite vers le
 * copier-coller plutôt qu'un silence qui laisserait croire à une biblio
 * déjà à jour.
 */
const FAMILY_FEEDBACK: Record<string, { text: string; className: string }> = {
  resync_vide: {
    text: "Aucun nouveau jeu détecté — Steam ne partage pas les jeux Family via son API pour ce compte. Colle la liste depuis la page Steam Family ci-dessous.",
    className: "bg-warning/10 text-warning",
  },
  prive: {
    text: "Ton profil Steam est privé, impossible de vérifier les jeux Family.",
    className: "bg-warning/10 text-warning",
  },
  indisponible: {
    text: "Steam est temporairement indisponible, réessaie dans un instant.",
    className: "bg-destructive/10 text-destructive",
  },
  rate_limited: { text: RATE_LIMIT_MESSAGE, className: "bg-warning/10 text-warning" },
};

const IDENTIFIERS_FEEDBACK: Record<string, string> = {
  ok: "Tes identifiants de jeu ont été enregistrés.",
  invalide: "Utilise au maximum 100 caractères par identifiant, sur une seule ligne.",
  rate_limited: RATE_LIMIT_MESSAGE,
};

export default async function ProfilParametresPage({
  searchParams,
}: {
  searchParams: Promise<{
    steam?: string;
    count?: string;
    upload?: string;
    family?: string;
    new?: string;
    notifications?: string;
    gouts?: string;
    materiel?: string;
    identifiants?: string;
    style?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { steam, count, upload, family, new: newCount, notifications, gouts, materiel, identifiants, style } = await searchParams;
  const uploadFeedback = upload ? UPLOAD_FEEDBACK[upload] : undefined;
  const familyFeedback = family ? FAMILY_FEEDBACK[family] : undefined;

  // Sprint 3 (FEATURE 6) — tous les tags existants + ceux déjà attribués à
  // ce user, pour afficher les chips "actif"/"inactif".
  const [allTags, ownUserTags, storedNotificationPreferences, preferenceGames, gameRefusals, communityId] = await Promise.all([
    prisma.tag.findMany({ orderBy: { name: "asc" } }),
    prisma.userTag.findMany({ where: { userId: user.id }, select: { tagId: true } }),
    prisma.userNotificationPreference.findMany({ where: { userId: user.id } }),
    visiblePreferenceGames(user.id),
    prisma.userGameRefusal.findMany({ where: { userId: user.id }, select: { gameId: true, game: { select: { name: true } } }, orderBy: [{ createdAt: "desc" }, { gameId: "asc" }] }),
    resolveActiveCommunityId(user.id),
  ]);
  const gameStyle = communityId ? await prisma.gameStyleProfile.findUnique({ where: { communityId_userId: { communityId, userId: user.id } } }) : null;
  const notificationPreferences = await getUserNotificationPreferences({
    silenceReminders: user.silenceReminders,
    notificationPreferences: storedNotificationPreferences,
  });
  const ownTagIds = new Set(ownUserTags.map((t) => t.tagId));

  return (
    <Stagger className="flex flex-col gap-6">
      <StaggerItem><Card className="flex flex-col gap-4">
        <h2 className="font-semibold">Mon style de jeu en équipe</h2>
        <p className="text-sm text-muted">Évalue chaque tendance de 0 (pas du tout) à 5 (beaucoup). Ces préférences servent à équilibrer les équipes de ta communauté.</p>
        {style === "ok" && <p role="status" className="text-sm text-accent">Profil enregistré.</p>}
        {style === "invalide" && <p role="alert" className="text-sm text-destructive">Choisis une valeur entre 0 et 5 pour chaque tendance.</p>}
        {!communityId ? <p className="text-sm text-muted">Choisis une communauté active pour enregistrer ton profil.</p> : <form action={saveGameStyleProfile} className="flex flex-col gap-3">
          {([["tryharder", "Tryharder"], ["ambianceur", "Ambianceur"], ["stratege", "Stratège"], ["chaos", "Chaos"]] as const).map(([key, label]) => <label key={key} className="flex items-center justify-between gap-4 text-sm"><span>{label}</span><input aria-label={label} name={key} type="number" min="0" max="5" required defaultValue={gameStyle?.[key] ?? 0} className="w-20 rounded-lg border border-border bg-background px-3 py-2" /></label>)}
          <Button type="submit" variant="primary">Enregistrer mon style</Button>
        </form>}
      </Card></StaggerItem>
      <StaggerItem><GamePreferencesForm user={user} games={preferenceGames} refusals={gameRefusals} feedback={gouts} /></StaggerItem>
      <StaggerItem><PlayerEquipmentForm user={user} feedback={materiel} /></StaggerItem>
      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Mes identifiants de jeu</h2>
          <p className="text-sm text-muted">Ces identifiants facultatifs sont visibles par les membres autorisés à consulter ta fiche. Leur existence n’est pas vérifiée. Laisse un champ vide pour l’effacer ; ton compte Steam se gère dans la section Steam.</p>
          {identifiants && IDENTIFIERS_FEEDBACK[identifiants] && <p role={identifiants === "ok" ? "status" : "alert"} className="text-sm">
            {IDENTIFIERS_FEEDBACK[identifiants]}
          </p>}
          <form action={updateGamingIdentifiersAction} className="flex flex-col gap-4">
            {GAMING_IDENTIFIER_FIELDS.map(({ key, label }) => <div key={key}>
              <label htmlFor={`gaming-${key}`} className="mb-1 block text-sm font-medium">{label}</label>
              <input id={`gaming-${key}`} name={key} type="text" maxLength={100} autoComplete="off" defaultValue={user[key] ?? ""} className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground focus-visible:outline-2 focus-visible:outline-accent" />
            </div>)}
            <Button type="submit" variant="primary">Enregistrer mes identifiants</Button>
          </form>
        </Card>
      </StaggerItem>
      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Bannière de profil</h2>
          {uploadFeedback && (
            <p className={`rounded-lg p-3 text-sm ${uploadFeedback.className}`}>
              {uploadFeedback.text}
            </p>
          )}
          <BannerForm
            initialUrl={user.bannerUrl}
            uploadEnabled={!!process.env.BLOB_READ_WRITE_TOKEN}
          />
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Notifications push</h2>
          <WebPushSettings publicKey={webPushConfig(process.env)?.publicKey ?? null} />
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Ma couleur</h2>
          <p className="text-sm text-muted">
            Ta couleur perso, visible sur le calendrier, ta bannière (sans
            image), ta fiche pote, tes votes et le classement.
          </p>
          <ColorPickerField currentColor={user.color} />
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Mes tags</h2>
          <p className="text-sm text-muted">
            Utilisés à la création d&apos;une soirée pour cocher d&apos;un
            coup tous les potes d&apos;un même tag (ex. sélectionner
            &laquo;&nbsp;FPS&nbsp;&raquo; pour prévenir tous les joueurs
            FPS).
          </p>
          <div className="flex flex-wrap gap-2">
            {allTags.map((tag) => {
              const active = ownTagIds.has(tag.id);
              const color = tagColor(tag.name);
              return (
                <form key={tag.id} action={toggleUserTagAction}>
                  <input type="hidden" name="tagId" value={tag.id} />
                  <button
                    type="submit"
                    aria-pressed={active}
                    className="rounded-full border px-3 py-1.5 text-xs font-medium transition-colors"
                    style={
                      active
                        ? {
                            backgroundColor: `color-mix(in srgb, ${color} 20%, transparent)`,
                            borderColor: color,
                            color,
                          }
                        : { borderColor: "var(--border)", color: "var(--muted)" }
                    }
                  >
                    {tag.name}
                  </button>
                </form>
              );
            })}
          </div>
          <form action={createTagAction} className="flex gap-2">
            <input
              type="text"
              name="name"
              maxLength={24}
              aria-label="Nom du nouveau tag"
              placeholder="Nouveau tag (ex. Retro)"
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            />
            <Button type="submit" variant="secondary" size="sm">
              + Ajouter
            </Button>
          </form>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Compte Steam</h2>

          {steam === "erreur" && (
            <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              La vérification Steam a échoué. Réessaie.
            </p>
          )}
          {steam === "indisponible" && (
            <ApiErrorBanner
              message="Données Steam temporairement indisponibles."
              onRetry={user.steamId64 ? reimportSteamLibrary : undefined}
            />
          )}
          {steam === "rate_limited" && (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              {RATE_LIMIT_MESSAGE}
            </p>
          )}
          {steam === "importe" && (
            <p className="rounded-lg bg-accent/10 p-3 text-sm text-accent">
              Bibliothèque Steam importée
              {count ? ` (${count} jeu${count === "1" ? "" : "x"})` : ""}.
            </p>
          )}
          {steam === "prive" && user.steamId64 && (
            <p className="rounded-lg bg-warning/10 p-3 text-sm text-warning">
              Ton profil Steam est privé, la bibliothèque ne peut pas être
              importée.{" "}
              <a
                href={steamPrivacySettingsUrl(user.steamId64)}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Régler la confidentialité de mon profil Steam
              </a>
              , puis réimporte depuis cette page.
            </p>
          )}

          {user.steamId64 ? (
            <>
              <p className="text-sm text-muted">
                Compte Steam lié ({user.steamId64}) — bibliothèque{" "}
                {user.steamPublic ? "publique" : "privée ou inconnue"}.
              </p>
              {/* Fix bug remonté — indicateur de fraîcheur, posé par
                  `importSteamLibrary` à chaque sync (lien, réimport manuel,
                  cron quotidien, resync Family). */}
              <p className="text-xs text-faint">
                {user.steamLastSyncAt
                  ? `Dernière sync : il y a ${formatDurationFr(nowMs() - user.steamLastSyncAt.getTime())}`
                  : "Jamais synchronisée."}
              </p>
              <form action={reimportSteamLibrary}>
                <Button type="submit" fullWidthOnMobile>
                  Réimporter ma bibliothèque Steam
                </Button>
              </form>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Lie ton compte Steam pour importer automatiquement les jeux
                que tu possèdes.
              </p>
              <ButtonLink
                href="/api/steam/link"
                fullWidthOnMobile
                className="bg-[#1b2838] text-white hover:bg-[#2a3f5a]"
              >
                Lier mon compte Steam
              </ButtonLink>
            </>
          )}
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Bibliothèque Steam Family</h2>

          {familyFeedback && (
            <p className={`rounded-lg p-3 text-sm ${familyFeedback.className}`}>
              {familyFeedback.text}
            </p>
          )}
          {family === "resync_ok" && (
            <p className="rounded-lg bg-accent/10 p-3 text-sm text-accent">
              {newCount} nouveau{newCount === "1" ? "" : "x"} jeu
              {newCount === "1" ? "" : "x"} importé{newCount === "1" ? "" : "s"}.
            </p>
          )}

          {user.steamId64 && (
            <form action={resyncSteamFamilyAction}>
              <Button type="submit" variant="secondary" fullWidthOnMobile>
                🔄 Resynchroniser Family
              </Button>
            </form>
          )}

          <FamilyImportForm />
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Notifications personnelles</h2>
          <p className="text-sm text-muted">
            Désactiver une catégorie supprime ses mentions Discord, ses messages privés et ses
            notifications dans l&apos;application. Les publications collectives restent visibles dans
            les salons, sans te mentionner.
          </p>
          {notifications === "ok" && (
            <p role="status" className="rounded-lg bg-accent/10 p-3 text-sm text-accent">
              Préférences enregistrées.
            </p>
          )}
          {notifications && notifications !== "ok" && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {notifications === "rate_limited"
                ? RATE_LIMIT_MESSAGE
                : notifications === "invalide"
                  ? "Réglage invalide. Recharge la page puis réessaie."
                  : "Impossible d’enregistrer ce réglage. Réessaie dans un instant."}
            </p>
          )}
          <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {AVAILABLE_NOTIFICATION_CATEGORIES.map((category) => {
              const enabled = notificationPreferences[category];
              const details = NOTIFICATION_CATEGORY_DETAILS[category];
              return (
                <div key={category} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-foreground">{details.label}</p>
                    <p className="text-sm text-muted">{details.description}</p>
                    <p className="mt-1 text-xs text-faint">
                      État enregistré : {enabled ? "activées" : "désactivées"}
                    </p>
                  </div>
                  <form action={updateNotificationPreferenceAction}>
                    <input type="hidden" name="category" value={category} />
                    <input type="hidden" name="enabled" value={String(!enabled)} />
                    <Button type="submit" variant="secondary" size="sm" fullWidthOnMobile aria-label={`${enabled ? "Désactiver" : "Activer"} les notifications personnelles : ${details.label}`}>
                      {enabled ? "Désactiver" : "Activer"}
                    </Button>
                  </form>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-faint">
            D’autres catégories (récompenses et récapitulatifs) seront ajoutées lorsque
            tous leurs chemins d’envoi appliqueront réellement ces préférences.
          </p>
          <ButtonLink href="/admin?tab=messages" variant="ghost" size="sm">
            Gérer les messages de rappel →
          </ButtonLink>
          <ButtonLink href="/admin?tab=superlatifs" variant="ghost" size="sm">
            Gérer les récompenses →
          </ButtonLink>
          <ButtonLink href="/admin?tab=badges" variant="ghost" size="sm">
            Gérer les badges →
          </ButtonLink>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Sons</h2>
          <p className="text-sm text-muted">
            {user.soundEnabled
              ? "Un son joue lors des célébrations (level up, badge débloqué, soirée validée)."
              : "Les célébrations restent visibles (confettis, notifications) mais sans son."}
          </p>
          <form action={toggleSoundEnabled}>
            <Button type="submit" variant="secondary" fullWidthOnMobile>
              {user.soundEnabled ? "🔇 Couper les sons" : "🔊 Activer les sons"}
            </Button>
          </form>
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Effets visuels</h2>
          <p className="text-sm text-muted">
            Une traînée de points violets suit ta souris sur desktop (design de
            fond). Purement cosmétique, réglage gardé sur cet appareil
            uniquement.
          </p>
          <CursorTrailToggle />
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Aide</h2>
          <p className="text-sm text-muted">
            Un rappel rapide de comment fonctionne chaque partie de
            l&apos;app.
          </p>
          <ButtonLink href="/guide" variant="secondary" fullWidthOnMobile>
            📖 Comment ça marche
          </ButtonLink>
        </Card>
      </StaggerItem>
    </Stagger>
  );
}
