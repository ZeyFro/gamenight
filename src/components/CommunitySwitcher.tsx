"use client";

import Image from "next/image";
import { useId, useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { changeCommunityAction } from "@/app/serveurs/actions";
import type { PickableCommunity } from "@/lib/community-picker";

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
      {icon && <Image src={icon} alt="" width={24} height={24} unoptimized className="rounded-full" />}
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
