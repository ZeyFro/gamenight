"use client";

import { useState } from "react";
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
 * plus jamais laisser un chargement raté invisible, `onError` bascule
 * sur le même dégradé de secours (`bannerFallbackStyle`) que l'absence de
 * bannière.
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
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return <div className={className} style={bannerFallbackStyle(color)} />;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- URL externe arbitraire (voir doc ci-dessus), `onError` nécessaire pour le repli.
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`object-cover ${className}`}
    />
  );
}
