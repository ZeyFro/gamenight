"use client";

import { useState } from "react";
import { isKnownNonImageBannerUrl } from "@/lib/banner-url";
import { bannerFallbackStyle } from "@/lib/user-color";

/**
 * Bannière de profil (perso sur `/profil` ou pote sur `/potes`) — `<img>`
 * natif plutôt que `next/image` (voir commentaire historique sur
 * `ProfilLayout` : `bannerUrl` est une URL externe arbitraire, impossible
 * à mettre sur liste blanche via `remotePatterns`) ET plutôt qu'un CSS
 * `background-image` (l'ancien rendu, avant ce fix) — un `<img>` est le
 * seul des deux à exposer un événement `onError` détectable en JS.
 *
 * Fix bug remonté : certaines bannières GIF (ex. hébergées sur klipy.com)
 * restaient invisibles sans indice — `ERR_BLOCKED_BY_RESPONSE.NotSameOrigin`
 * dans la console, causé par un en-tête `Cross-Origin-Resource-Policy`
 * posé côté hébergeur du GIF, hors de notre contrôle (aucune option côté
 * navigateur — `referrerPolicy` compris, posé ci-dessous à tout hasard
 * pour les hébergeurs qui bloquent plutôt sur la présence d'un Referer —
 * ne contourne un vrai blocage CORP). Le vrai fix accessible ici : ne
 * plus jamais laisser un chargement raté invisible, un échec bascule
 * sur le même dégradé de secours (`bannerFallbackStyle`) que l'absence de
 * bannière.
 *
 * Trois cas de repli, du plus sûr au plus tardif :
 *   1. lien connu pour NE PAS être une image (page klipy / Tenor / Giphy,
 *      déjà en base avant le refus à l'écriture) : dégradé tout de suite, sans
 *      requête (`isKnownNonImageBannerUrl`) ;
 *   2. échec AVANT l'hydratation : la page est rendue côté serveur, le
 *      navigateur lance le chargement dès le HTML reçu et un blocage rapide
 *      (CORP, 404) déclenche `error` avant que React ait attaché `onError` —
 *      l'événement est perdu. Le `ref` rattrape ce cas au montage (image déjà
 *      terminée mais sans aucune dimension) ;
 *   3. échec APRÈS l'hydratation : `onError`.
 * L'échec est mémorisé PAR URL : si `url` change (nouvelle bannière
 * enregistrée alors que le composant reste monté), l'ancien échec ne condamne
 * pas la nouvelle image au dégradé de secours.
 *
 * Limite assumée du cas 2 : un SVG sans dimensions intrinsèques serait pris
 * pour un échec ; les bannières sont des images matricielles (GIF/PNG/JPEG).
 */
export function BannerImage({
  url,
  color,
  className = "",
}: {
  url: string | null;
  color: string;
  className?: string;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!url || failedUrl === url || isKnownNonImageBannerUrl(url)) {
    return <div className={className} style={bannerFallbackStyle(color)} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL externe arbitraire (voir doc ci-dessus), `onError` nécessaire pour le repli.
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      ref={(img) => {
        if (img && img.complete && img.naturalWidth === 0 && img.naturalHeight === 0) {
          setFailedUrl(url);
        }
      }}
      onError={() => setFailedUrl(url)}
      className={`object-cover ${className}`}
    />
  );
}
