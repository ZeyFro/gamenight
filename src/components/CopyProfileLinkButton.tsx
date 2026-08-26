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
 */
export function CopyProfileLinkButton({ userId }: { userId: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      const url = `${window.location.origin}/potes/${userId}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("Lien copié");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Impossible de copier le lien");
    }
  }

  return (
    <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
      {copied ? "✓ Copié" : "🔗 Copier le lien"}
    </Button>
  );
}
