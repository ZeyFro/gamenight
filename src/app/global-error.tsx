"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";

/**
 * Filet de secours pour les erreurs du root layout lui-même (Header,
 * `auth()`, `CursorTrail`...) — `error.tsx` ne les couvre pas (cf. son
 * propre commentaire : il ne capture que les erreurs sous le layout
 * racine, pas le layout lui-même). Sans ce fichier, un crash à cet
 * endroit produisait une page blanche muette (aucun boundary React pour
 * l'intercepter) plutôt qu'un message diagnosticable — le `digest` loggé
 * ci-dessous permet de retrouver l'erreur exacte dans les logs Vercel la
 * prochaine fois que ça arrive.
 *
 * Doit définir son propre `<html>`/`<body>` (remplace tout le root layout
 * quand actif, cf. doc Next.js) — volontairement sans Framer Motion ni
 * les autres providers du reste de l'app : c'est le dernier filet, il
 * doit rester rendable même si la cause du crash est ailleurs dans
 * l'arbre. Actif uniquement en production (Next.js désactive ce fichier
 * en dev pour laisser l'overlay d'erreur habituel).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logger.error("global-error-boundary", error, { digest: error.digest });
  }, [error]);

  return (
    <html lang="fr">
      <body
        style={{
          display: "flex",
          minHeight: "100vh",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "2rem 1.5rem",
          textAlign: "center",
          backgroundColor: "#0a0a0f",
          color: "#f4f4f5",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <span style={{ fontSize: "3.5rem" }} aria-hidden>
          💀
        </span>
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Erreur critique</h1>
          <p style={{ marginTop: "0.5rem", color: "#a1a1aa" }}>
            L&apos;application a rencontré un problème inattendu.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          style={{
            borderRadius: "9999px",
            padding: "0.625rem 1.5rem",
            fontSize: "0.875rem",
            fontWeight: 500,
            backgroundColor: "#8b5cf6",
            color: "#fff",
            border: "none",
            cursor: "pointer",
          }}
        >
          Réessayer
        </button>
      </body>
    </html>
  );
}
