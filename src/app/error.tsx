"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { Button, ButtonLink } from "@/components/ui/Button";

/**
 * Error boundary racine (Sprint 1 v2, fiabilisation) — Next impose un
 * Client Component ici (`error`/`reset` passés en props par le framework,
 * pas des données qu'on peut fetch soi-même). Ne capture pas les erreurs du
 * layout racine lui-même (Header, `auth()`) — hors périmètre demandé,
 * réservé à `global-error.tsx` si un jour nécessaire.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Capturé par les logs Vercel en prod — pas de service d'erreur dédié
    // dans cette app pour l'instant.
    console.error(error);
  }, [error]);

  return (
    <div className="bg-hero-gradient flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col items-center gap-4"
      >
        <motion.span
          className="text-6xl"
          aria-hidden
          animate={{ opacity: [1, 0.4, 1] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        >
          💀
        </motion.span>
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            500 — Le serveur a crash
          </h1>
          <p className="mt-2 text-muted">On respawn bientôt. Réessaie dans un instant.</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button variant="primary" fullWidthOnMobile onClick={reset}>
            Réessayer
          </Button>
          <ButtonLink href="/" variant="secondary" fullWidthOnMobile>
            Retour à l&apos;accueil
          </ButtonLink>
        </div>
      </motion.div>
    </div>
  );
}
