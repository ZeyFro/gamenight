"use client";

import Image from "next/image";
import { useId, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { changeCommunityAction } from "@/app/serveurs/actions";
import type { PickableCommunity } from "@/lib/community-picker";

/**
 * Icône du serveur : l’image Discord seulement si elle charge. Un `iconHash` périmé (icône changée ou supprimée côté Discord)
 * donnait une image cassée à côté du sélecteur sur toutes les pages (audit de la production du 23/11/2026) : sur erreur de
 * chargement, repli sur l’initiale du serveur dans un rond, sans image cassée. Aucun appel réseau supplémentaire côté serveur.
 */
export function CommunityIcon({ src, name }: { src: string | null; name: string }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  if (src && failedSrc !== src) {
    return <Image src={src} alt="" width={24} height={24} unoptimized className="rounded-full" onError={() => setFailedSrc(src)} />;
  }
  return <span aria-hidden="true" data-testid="community-icon-fallback" className="gn-community-icon flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-bold text-foreground">{initial}</span>;
}

export function CommunitySwitcher({ communities, currentId }: { communities: PickableCommunity[]; currentId: string | null }) {
  const id = useId();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const current = communities.find((c) => c.id === currentId);
  const icon = current?.discordGuildId && current.iconHash
    ? `https://cdn.discordapp.com/icons/${current.discordGuildId}/${current.iconHash}.png?size=64` : null;
  return (
    <div className="gn-community-switcher">
      {current && <CommunityIcon src={icon} name={current.name} />}
      <label htmlFor={id} className="gn-eyebrow hidden xl:block">Serveur actuel</label>
      <select id={id} aria-label="Changer de serveur" value={currentId ?? ""} disabled={pending || communities.length < 2}
        className="gn-server-select"
        onChange={(event) => {
          const communityId = event.target.value;
          setError("");
          startTransition(async () => {
            try {
              const accepted = await changeCommunityAction(communityId);
              if (!accepted) { setError("Ce serveur n’est plus accessible."); router.refresh(); return; }
              // Leave detail/form routes tied to the previous server; reload collective data.
              router.replace("/");
              router.refresh();
            } catch { setError("Le changement a échoué. Réessaie."); }
          });
        }}>
        {!currentId && <option value="">{communities.length ? "Choisir un serveur" : "Aucun serveur accessible"}</option>}
        {communities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      {pending && <span role="status" className="text-xs text-muted">Changement…</span>}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  );
}
