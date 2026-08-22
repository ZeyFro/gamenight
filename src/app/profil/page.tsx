import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { steamPrivacySettingsUrl } from "@/lib/steam";
import { reimportSteamLibrary } from "@/app/actions";
import { toggleSilenceReminders } from "./actions";
import { Card } from "@/components/ui/Card";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import { levelForXp, rankForLevel, titleForLevel, xpForLevel } from "@/lib/xp";

export default async function ProfilPage({
  searchParams,
}: {
  searchParams: Promise<{ steam?: string; count?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { steam, count } = await searchParams;

  const level = levelForXp(user.xpTotal);
  const rank = rankForLevel(level);
  const title = titleForLevel(level);
  const xpIntoLevel = user.xpTotal - xpForLevel(level);
  const xpForNextLevel = xpForLevel(level + 1) - xpForLevel(level);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-xl font-semibold text-foreground sm:text-2xl">
        Mon profil
      </h1>

      <Stagger className="flex flex-col gap-6">
        <StaggerItem>
          <Card className="flex items-center gap-4">
            {user.discordAvatar && (
              <Image
                src={user.discordAvatar}
                alt={`Avatar de ${user.discordName}`}
                width={56}
                height={56}
                className="rounded-full"
              />
            )}
            <div>
              <p className="font-semibold text-foreground">
                {user.discordName}
              </p>
              <p className="text-sm text-muted">Connecté via Discord</p>
            </div>
          </Card>
        </StaggerItem>

        {/*
          Aperçu XP minimal — juste de quoi vérifier en prod que le
          backfill donne des chiffres cohérents avec l'historique réel
          (demande explicite avant d'enchaîner sur la PR suivante du
          chantier). La vraie refonte visuelle (bannière, anneau de rang
          sur l'avatar, cartes stats, onglets) arrive en PR 8/9.
        */}
        <StaggerItem>
          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold text-foreground">
                Niveau {level} — {title}
              </h2>
              <span className={`rounded-full px-3 py-1 text-xs font-medium ${rank.colorClass}`}>
                {rank.name}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="h-2 overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{
                    width: `${Math.min(100, (xpIntoLevel / xpForNextLevel) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted">
                {user.xpTotal} XP au total — {xpIntoLevel} / {xpForNextLevel}{" "}
                vers le niveau {level + 1}
              </p>
            </div>
            <p className="text-sm text-muted">
              🔥 Streak : {user.streakCount} jour
              {user.streakCount > 1 ? "s" : ""} d&apos;affilée
            </p>
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
            <h2 className="font-semibold text-foreground">Rappels Discord</h2>
            <p className="text-sm text-muted">
              {user.silenceReminders
                ? "Tu n'es plus mentionné dans les rappels de soirée (le message reste posté dans le salon)."
                : "Tu es mentionné dans les rappels de soirée avant chaque session."}
            </p>
            <form action={toggleSilenceReminders}>
              <Button type="submit" variant="secondary" fullWidthOnMobile>
                {user.silenceReminders
                  ? "🔔 Réactiver les rappels"
                  : "🔕 Couper les rappels"}
              </Button>
            </form>
            <ButtonLink href="/admin/messages" variant="ghost" size="sm">
              Gérer les messages de rappel →
            </ButtonLink>
            <ButtonLink href="/admin/superlatifs" variant="ghost" size="sm">
              Gérer les superlatifs →
            </ButtonLink>
          </Card>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
