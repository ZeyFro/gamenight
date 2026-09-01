import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { steamPrivacySettingsUrl } from "@/lib/steam";
import { reimportSteamLibrary } from "@/app/actions";
import { toggleSilenceReminders } from "@/app/profil/actions";
import { Card } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { BannerForm } from "@/components/BannerForm";
import { ColorPickerField } from "@/components/ColorPickerField";
import { FamilyImportForm } from "@/components/FamilyImportForm";
import { ApiErrorBanner } from "@/components/ApiErrorBanner";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

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
};

export default async function ProfilParametresPage({
  searchParams,
}: {
  searchParams: Promise<{ steam?: string; count?: string; upload?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { steam, count, upload } = await searchParams;
  const uploadFeedback = upload ? UPLOAD_FEEDBACK[upload] : undefined;

  return (
    <Stagger className="flex flex-col gap-6">
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
          <FamilyImportForm />
        </Card>
      </StaggerItem>

      <StaggerItem>
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold text-foreground">Rappels Discord</h2>
          <p className="text-sm text-muted">
            {user.silenceReminders
              ? "Tu n'es plus mentionné dans les rappels de soirée (le message reste posté dans le salon)."
              : "Tu es mentionné dans les rappels de soirée avant chaque session."}
          </p>
          <form action={toggleSilenceReminders}>
            <Button type="submit" variant="secondary" fullWidthOnMobile>
              {user.silenceReminders ? "🔔 Réactiver les rappels" : "🔕 Couper les rappels"}
            </Button>
          </form>
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
    </Stagger>
  );
}
