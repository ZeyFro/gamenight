import Image from "next/image";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { deleteSessionGalleryImageAction, uploadSessionGalleryImageAction } from "@/app/sessions/actions/gallery";
import { SESSION_GALLERY_MAX_ITEMS } from "@/lib/session-gallery";

type GalleryImage = { id: string; uploadedById: string; mimeType: string; createdAt: Date };

const RESULT: Record<string, string> = {
  ok: "Galerie mise à jour.",
  "trop-lourd": "Image trop volumineuse (4 Mo maximum).",
  format: "Format non pris en charge. Utilise JPEG, PNG, GIF ou WebP.",
  pleine: "La galerie de cette soirée est pleine (8 images maximum).",
  desactive: "La galerie n’est pas activée pour cette communauté.",
  indisponible: "L’envoi est momentanément indisponible.",
  echec: "L’image n’a pas pu être enregistrée.",
};

export function SessionGallery({
  sessionId,
  userId,
  creatorId,
  images,
  result,
  storageReady,
}: {
  sessionId: string;
  userId: string;
  creatorId: string;
  images: GalleryImage[];
  result?: string;
  storageReady: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-foreground">📸 Galerie de la soirée</h2>
      <Card className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          Photos JPEG, PNG, GIF ou WebP : 4 Mo maximum par image, 8 images par soirée. Seuls les invités actifs et le créateur peuvent les voir. Les clips vidéo ne sont pas encore pris en charge.
        </p>
        {result && RESULT[result] && <p role="status" className="text-sm text-muted">{RESULT[result]}</p>}
        {!storageReady && <p role="status" className="text-sm text-muted">Le stockage Blob privé n’est pas configuré.</p>}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((image) => (
            <figure key={image.id} className="flex flex-col gap-2">
              <Image
                src={`/api/sessions/${sessionId}/media/${image.id}`}
                alt="Photo partagée dans la galerie de la soirée"
                width={320}
                height={240}
                unoptimized
                loading="lazy"
                className="aspect-[4/3] w-full rounded-lg object-cover"
              />
              {(image.uploadedById === userId || creatorId === userId) && (
                <form action={deleteSessionGalleryImageAction}>
                  <input type="hidden" name="sessionId" value={sessionId} />
                  <input type="hidden" name="mediaId" value={image.id} />
                  <Button type="submit" size="sm" variant="secondary">Supprimer</Button>
                </form>
              )}
            </figure>
          ))}
        </div>
        {storageReady && images.length < SESSION_GALLERY_MAX_ITEMS && (
          <form action={uploadSessionGalleryImageAction} className="flex flex-col gap-3 border-t border-border pt-4">
            <input type="hidden" name="sessionId" value={sessionId} />
            <label htmlFor={`${sessionId}-media`} className="text-sm font-medium">Ajouter une photo</label>
            <input id={`${sessionId}-media`} type="file" name="media" accept="image/jpeg,image/png,image/gif,image/webp" required className="text-sm" />
            <label className="flex items-start gap-2 text-sm text-muted">
              <input type="checkbox" name="consent" required className="mt-1" />
              <span>J’accepte que les membres invités de cette soirée puissent consulter cette image.</span>
            </label>
            <Button type="submit" size="sm">Partager dans la galerie</Button>
          </form>
        )}
      </Card>
    </section>
  );
}
