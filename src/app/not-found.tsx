"use client";

import { motion } from "framer-motion";
import { ButtonLink } from "@/components/ui/Button";

/**
 * 404 custom (Sprint 1 v2, fiabilisation) — remplace la page par défaut de
 * Next, déjà déclenchée par les `notFound()` existants (fiche jeu/pote/
 * session introuvable) en plus des routes qui n'existent pas. `MotionConfig
 * reducedMotion="user"` posé dans `layout.tsx` désactive déjà
 * automatiquement les animations pour `prefers-reduced-motion` — pas besoin
 * de le regérer ici.
 */
export default function NotFound() {
  return (
    <div className="bg-hero-gradient flex flex-1 flex-col items-center justify-center gap-6 px-4 py-16 text-center sm:px-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col items-center gap-4"
      >
        <div>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            404 — Cette page a rage quit{" "}
            <motion.span
              className="inline-block"
              animate={{ rotate: [0, -10, 10, -10, 0] }}
              transition={{
                duration: 1.4,
                repeat: Infinity,
                repeatDelay: 1.2,
                ease: "easeInOut",
              }}
            >
              🎮
            </motion.span>
          </h1>
          <p className="mt-2 text-muted">
            Introuvable — elle a probablement déco sans prévenir.
          </p>
        </div>
        <ButtonLink href="/" variant="primary" fullWidthOnMobile>
          Retour à l&apos;accueil
        </ButtonLink>
      </motion.div>
    </div>
  );
}
