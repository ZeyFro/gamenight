import { TrailerConsentEmbed } from "@/components/TrailerConsentEmbed";
import { isMediaPrivacyEnabled, YOUTUBE_EMBED_ORIGIN } from "@/lib/media-privacy";

/**
 * Trailer d'une fiche jeu. `MEDIA_PRIVACY_ENABLED` éteint : iframe immédiate
 * (comportement historique). Allumé : bloc d'information puis iframe après clic.
 */
export function GameTrailer({ videoId, gameName }: { videoId: string; gameName: string }) {
  const title = `Trailer de ${gameName}`;
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-surface-hover">
      {isMediaPrivacyEnabled() ? (
        <TrailerConsentEmbed videoId={videoId} title={title} />
      ) : (
        <iframe
          src={`${YOUTUBE_EMBED_ORIGIN}${videoId}`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      )}
    </div>
  );
}
