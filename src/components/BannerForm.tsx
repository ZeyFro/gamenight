"use client";

import { useState } from "react";
import { setBannerUrlAction } from "@/app/profil/actions";
import { Button } from "@/components/ui/Button";

/**
 * Bannière de profil (PR 8/9) — champ URL avec preview live, pas
 * d'upload de fichier (décision documentée dans le README : la
 * complexité d'un vrai stockage/service tiers n'était pas justifiée
 * pour v1, l'utilisateur a explicitement laissé le choix). La preview
 * réutilise `.profile-banner-default` quand le champ est vide, pour
 * montrer exactement ce que verront les autres.
 */
export function BannerForm({ initialUrl }: { initialUrl: string | null }) {
  const [url, setUrl] = useState(initialUrl ?? "");

  return (
    <form action={setBannerUrlAction} className="flex flex-col gap-3">
      <div
        className={`h-32 w-full overflow-hidden rounded-lg ${!url ? "profile-banner-default" : ""}`}
        style={
          url
            ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined
        }
      />
      <input
        type="url"
        name="bannerUrl"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://exemple.com/ma-banniere.jpg (1500×500 recommandé)"
        className="w-full rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
      />
      <p className="text-xs text-faint">
        Vide = bannière par défaut (dégradé violet). Format 1500×500 recommandé,
        d&apos;autres ratios sont acceptés (recadrage automatique centré).
      </p>
      <Button type="submit" variant="primary" fullWidthOnMobile>
        Enregistrer la bannière
      </Button>
    </form>
  );
}
