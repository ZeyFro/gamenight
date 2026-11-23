import { Card } from "@/components/ui/Card";
import { DISCORD_PHOTOS_CHANNEL_NAME } from "@/lib/discord-photos-channel";

/** Renvoi vers le salon Discord des photos (Q6) : l'application ne stocke pas les photos des soirées. */
export function SessionPhotosLink({ url }: { url: string }) {
  return (
    <section aria-label="Photos de la soirée" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">📸 Photos de la soirée</h2>
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Partage tes photos et vidéos dans le salon <span className="font-medium text-foreground">{DISCORD_PHOTOS_CHANNEL_NAME}</span> sur Discord.</p>
        <a href={url} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-border px-4 py-2 text-sm text-accent hover:underline">Ouvrir le salon</a>
      </Card>
    </section>
  );
}
