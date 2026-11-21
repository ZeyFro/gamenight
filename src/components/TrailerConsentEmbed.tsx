"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { YOUTUBE_EMBED_ORIGIN } from "@/lib/media-privacy";

/**
 * Bloc statique tant que le membre n'a pas cliqué : aucune requête vers
 * YouTube ni i.ytimg.com (pas de vignette distante). L'iframe n'est créée
 * qu'après le clic.
 */
export function TrailerConsentEmbed({ videoId, title }: { videoId: string; title: string }) {
  const [shown, setShown] = useState(false);

  if (shown) {
    return (
      <iframe
        src={`${YOUTUBE_EMBED_ORIGIN}${videoId}?autoplay=1`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        loading="lazy"
        className="h-full w-full"
      />
    );
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4 text-center">
      <span aria-hidden="true" className="text-3xl">▶</span>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-md text-sm text-muted">
        Cette vidéo vient de YouTube (Google) ; ton adresse IP lui sera transmise.
      </p>
      <Button type="button" size="sm" onClick={() => setShown(true)}>
        Afficher la vidéo
      </Button>
    </div>
  );
}
