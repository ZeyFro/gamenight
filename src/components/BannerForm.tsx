"use client";

import { useState } from "react";
import { setBannerUrlAction, uploadBannerAction } from "@/app/profil/actions";
import { Button } from "@/components/ui/Button";

const MAX_BANNER_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_BANNER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

// Infra (Sprint 5 suite, I3) — bande passante Vercel Hobby limitée : une
// bannière n'a jamais besoin d'être plus grande que sa taille d'affichage
// (1500×500 recommandé, cf. placeholder ci-dessous) ni conservée au format
// d'origine (souvent un PNG/JPEG plein cadre sorti tel quel du téléphone,
// plusieurs Mo). Redimensionnée et recompressée côté client (canvas,
// qualité 80%) AVANT l'upload Vercel Blob — jamais après, l'objectif est
// justement de ne pas envoyer l'original lourd sur le réseau.
const BANNER_MAX_WIDTH = 1500;
const BANNER_MAX_HEIGHT = 500;
const BANNER_COMPRESS_QUALITY = 0.8;

/**
 * Redimensionne (sans jamais agrandir) et recompresse une image côté
 * client via `<canvas>`. Retourne le fichier original si le
 * redimensionnement échoue (canvas indisponible, décodage impossible…) —
 * dégradation silencieuse, l'upload doit rester possible même si cette
 * optimisation échoue.
 *
 * Fix bug remonté (bannières GIF invisibles) : ne JAMAIS appeler cette
 * fonction sur un GIF — `drawImage` ne capture que la 1ère frame et
 * `canvas.toBlob` ré-encode toujours en JPEG statique (pas de support GIF),
 * ce qui détruit l'animation. Les GIF doivent être uploadés tels quels
 * (voir l'appelant, qui saute cet appel pour `image/gif`).
 */
async function compressBannerImage(file: File): Promise<File> {
  try {
    const objectUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Image illisible."));
      image.src = objectUrl;
    });

    const scale = Math.min(1, BANNER_MAX_WIDTH / img.width, BANNER_MAX_HEIGHT / img.height);
    const width = Math.round(img.width * scale);
    const height = Math.round(img.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Contexte canvas indisponible.");
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(objectUrl);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", BANNER_COMPRESS_QUALITY)
    );
    if (!blob) throw new Error("Compression échouée.");

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

function BannerPreview({ url }: { url: string | null }) {
  return (
    <div
      className={`h-32 w-full overflow-hidden rounded-lg ${!url ? "profile-banner-default" : ""}`}
      style={
        url
          ? { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }
          : undefined
      }
    />
  );
}

/**
 * Bannière de profil — deux méthodes au choix (fix UX PR 9/9, suite au
 * test prod de la PR 8/9 où l'URL-only s'est révélée pénible sans image
 * déjà hébergée) : coller une URL, ou uploader un fichier vers Vercel
 * Blob (voir `uploadBannerAction`, dégradation propre si
 * `BLOB_READ_WRITE_TOKEN` n'est pas configuré). Deux `<form>` séparés
 * (pas un seul formulaire avec les deux champs) car chacun appelle une
 * server action différente avec une shape de payload différente
 * (texte vs fichier) — plus simple que de dispatcher sur un seul champ
 * `mode` côté serveur.
 */
export function BannerForm({
  initialUrl,
  uploadEnabled,
}: {
  initialUrl: string | null;
  uploadEnabled: boolean;
}) {
  const [mode, setMode] = useState<"url" | "upload">("url");
  const [url, setUrl] = useState(initialUrl ?? "");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const input = e.target;
    const file = input.files?.[0];
    setFileError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);

    if (!file) return;

    if (!ALLOWED_BANNER_MIME_TYPES.includes(file.type)) {
      setFileError("Format non supporté (jpg, png, webp ou gif uniquement).");
      input.value = "";
      return;
    }
    if (file.size > MAX_BANNER_UPLOAD_BYTES) {
      setFileError("Fichier trop lourd (5 Mo max).");
      input.value = "";
      return;
    }

    // Les GIF ne passent jamais par la compression canvas (voir doc de
    // `compressBannerImage`) : elle les remplacerait par un JPEG statique
    // 1ère frame, donc une bannière "GIF" qui ne bouge plus — déjà limités
    // à 5 Mo ci-dessus, l'upload part directement du fichier original.
    const compressed = file.type === "image/gif" ? file : await compressBannerImage(file);
    // Remplace le fichier sélectionné par la version compressée : l'upload
    // (form action native, pas un fetch piloté ici) part bien de ce fichier
    // réduit, jamais de l'original.
    const transfer = new DataTransfer();
    transfer.items.add(compressed);
    input.files = transfer.files;

    setPreviewUrl(URL.createObjectURL(compressed));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 rounded-lg border border-border bg-background p-1">
        <button
          type="button"
          onClick={() => setMode("url")}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === "url" ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          URL
        </button>
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            mode === "upload" ? "bg-accent text-accent-foreground" : "text-muted hover:text-foreground"
          }`}
        >
          Uploader une image
        </button>
      </div>

      {mode === "url" ? (
        <form action={setBannerUrlAction} className="flex flex-col gap-3">
          <BannerPreview url={url} />
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
      ) : uploadEnabled ? (
        <form action={uploadBannerAction} className="flex flex-col gap-3">
          <BannerPreview url={previewUrl} />
          <input
            type="file"
            name="bannerFile"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleFileChange}
            className="w-full rounded-lg border border-border bg-background px-3 py-3 text-sm text-foreground file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-2 file:text-sm file:font-medium file:text-accent-foreground"
          />
          {fileError ? (
            <p className="text-xs text-destructive">{fileError}</p>
          ) : (
            <p className="text-xs text-faint">
              5 Mo max — jpg, png, webp ou gif. Format 1500×500 recommandé.
            </p>
          )}
          <Button type="submit" variant="primary" fullWidthOnMobile disabled={!!fileError}>
            Uploader la bannière
          </Button>
        </form>
      ) : (
        <p className="rounded-lg border border-border bg-background p-3 text-sm text-muted">
          Fonctionnalité désactivée, contacte l&apos;admin.
        </p>
      )}
    </div>
  );
}
