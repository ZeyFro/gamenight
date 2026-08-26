"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";

/**
 * "Copier le lien de mon profil" (PR 8/9) — copie `/potes/{userId}`, pas
 * `/profil` : `/profil` affiche TOUJOURS les données du user connecté
 * (aucune notion de "profil de qui" dans son URL), donc partager ce lien
 * littéral montrerait à chaque destinataire SON PROPRE profil, pas celui
 * qu'on veut partager — un vrai bug, pas un détail. `/potes/{userId}`
 * est la route qui affiche réellement les infos de ce user pour
 * n'importe quel autre membre du groupe qui clique le lien.
 *
 * "Partage rapide sur Discord" (bonus PR 9/9) — même lien, mais
 * pré-formaté en message prêt à coller, pour éviter le clic
 * "copier le lien" + retaper une phrase d'intro à la main.
 */
export function CopyProfileLinkButton({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);

  function profileUrl() {
    return `${window.location.origin}/potes/${userId}`;
  }

  async function handleCopyLink() {
    try {
      await navigator.clipboard.writeText(profileUrl());
      setCopied(true);
      toast.success("Lien copié");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Impossible de copier le lien");
    }
  }

  async function handleCopyDiscordMessage() {
    try {
      await navigator.clipboard.writeText(
        `Yo, regardez mon profil GameNight : ${profileUrl()}`
      );
      setCopiedMessage(true);
      toast.success("Message copié, prêt à coller sur Discord");
      setTimeout(() => setCopiedMessage(false), 2000);
    } catch {
      toast.error("Impossible de copier le message");
    }
  }

  return (
    <div className="flex gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={handleCopyLink}>
        {copied ? "✓ Copié" : "🔗 Copier le lien"}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={handleCopyDiscordMessage}>
        {copiedMessage ? "✓ Copié" : "📋 Message Discord"}
      </Button>
    </div>
  );
}
