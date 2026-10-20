import Image from "next/image";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { deleteSessionGalleryImageAction, uploadSessionGalleryImageAction } from "@/app/sessions/actions/gallery";
import { SESSION_GALLERY_MAX_ITEMS } from "@/lib/session-gallery";

type GalleryMedia = { id: string; uploadedById: string; mimeType: string; createdAt: Date };

const RESULT: Record<string, string> = {
  ok: "Galerie mise à jour.",
  "trop-lourd": "Image trop volumineuse (4 Mo maximum).",
  format: "Format non pris en charge. Utilise JPEG, PNG, GIF ou WebP.",
  "video-desactive": "Les clips vidéo sont désactivés pour le moment.",
  pleine: "La galerie de cette soirée est pleine (8 images maximum).",
  desactive: "La galerie n’est pas activée pour cette communauté.",
  indisponible: "L’envoi est momentanément indisponible.",
  echec: "L’image n’a pas pu être enregistrée.",
};

export function SessionGallery({
  sessionId,
  canManage,
  images,
  result,
  storageReady,
  videosEnabled,
}: {
  sessionId: string;
  canManage: boolean;
  images: GalleryMedia[];
  result?: string;
  storageReady: boolean;
  videosEnabled: boolean;
}) {
  const visibleMedia = images.filter((media) => videosEnabled || media.mimeType !== "video/mp4");
  const resultText = result === "trop-lourd" && videosEnabled
    ? "Le média dépasse la limite de 4 Mo."
    : result === "format" && videosEnabled
      ? "Format non pris en charge. Utilise JPEG, PNG, GIF, WebP ou MP4."
      : result === "pleine" && videosEnabled
        ? "La galerie de cette soirée est pleine (8 médias maximum)."
        : result ? RESULT[result] : undefined;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">📸 Galerie de la soirée</h2>
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {videosEnabled
            ? "Photos JPEG, PNG, GIF ou WebP et clips MP4 : 4 Mo maximum par média, 8 médias par soirée. Seuls les invités actifs et le créateur peuvent les voir."
            : "Photos JPEG, PNG, GIF ou WebP : 4 Mo maximum par image, 8 images par soirée. Seuls les invités actifs et le créateur peuvent les voir. Les clips vidéo sont désactivés pour le moment."}
        </p>
        {resultText && <p role="status" className="text-sm text-muted">{resultText}</p>}
        {!storageReady && <p role="status" className="text-sm text-muted">Le stockage Blob privé n’est pas configuré.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {visibleMedia.map((item) => (
            <figure key={item.id} className="flex flex-col gap-2">
              {item.mimeType === "video/mp4" ? (
                <>
                  <video controls playsInline preload="metadata" className="w-full rounded-lg" aria-label="Clip partagé dans la galerie de la soirée">
                    <source src={`/api/sessions/${sessionId}/media/${item.id}`} type="video/mp4" />
                    La lecture vidéo n’est pas prise en charge par ce navigateur.
                  </video>
                  <p className="text-xs text-muted">La lecture dépend du navigateur et du codec du fichier.</p>
                  <a href={`/api/sessions/${sessionId}/media/${item.id}`} download className="text-sm text-accent underline">Télécharger le clip</a>
                </>
              ) : (
                <Image
                  src={`/api/sessions/${sessionId}/media/${item.id}`}
                  alt="Photo partagée dans la galerie de la soirée"
                  width={320}
                  height={240}
                  unoptimized
                  loading="lazy"
                  className="aspect-[4/3] w-full rounded-lg object-cover"
                />
              )}
              {canManage && (
                <form action={deleteSessionGalleryImageAction}>
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <input type="hidden" name="mediaId" value={item.id} />
                  <Button type="submit" size="sm" variant="secondary">Supprimer</Button>
                </form>
              )}
            </figure>
          ))}
        </div>
        {canManage && storageReady && images.length < SESSION_GALLERY_MAX_ITEMS && (
          <form action={uploadSessionGalleryImageAction} className="flex flex-col gap-3 border-t border-border pt-4">
            <input type="hidden" name="sessionId" value={sessionId} />
            <label htmlFor={`${sessionId}-media`} className="text-sm font-medium">{videosEnabled ? "Ajouter un média" : "Ajouter une photo"}</label>
            <input id={`${sessionId}-media`} type="file" name="media" accept={`image/jpeg,image/png,image/gif,image/webp${videosEnabled ? ",video/mp4" : ""}`} required className="text-sm" />
            <label className="flex items-start gap-2 text-sm text-muted">
              <input type="checkbox" name="consent" required className="mt-1" />
              <span>{videosEnabled ? "J’accepte que les membres invités de cette soirée puissent consulter cette photo ou ce clip." : "J’accepte que les membres invités de cette soirée puissent consulter cette image."}</span>
            </label>
            <Button type="submit" size="sm">Partager dans la galerie</Button>
          </form>
        )}
      </Card>
    </section>
  );
}
