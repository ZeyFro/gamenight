import { NextResponse, after } from "next/server";
import { verifyCronRequest } from "@/lib/cron-auth";
import { logger } from "@/lib/logger";
import { boostersEnabled, runBoosterSync } from "@/lib/booster-support";
import { withRoleCreationLock } from "@/lib/discord-role-lock";

// Un appel REST Discord par membre vérifié (lots de 100, budget interne 40 s) : 202 + `after()`.
export const maxDuration = 60;

/**
 * Lit `premium_since` des membres (REST, sans gateway) pour les soutiens Nitro. Strictement cosmétique.
 * Aucun cron créé automatiquement : la cadence relève de la configuration externe. Éteint
 * (`DISCORD_BOOSTERS_ENABLED` absent), répond `{enabled:false}` en 200 sans rien lire.
 */
export async function GET(request: Request) {
  const auth = verifyCronRequest(request);
  if (!auth.ok) {
    if (auth.status === 503) return NextResponse.json({ error: "not_configured" }, { status: 503 });
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!boostersEnabled()) return NextResponse.json({ enabled: false });

  after(async () => {
    const startedAt = Date.now();
    logger.info("cron:booster-sync", "Synchronisation des soutiens début.");
    try {
      // Verrou : deux passages qui se chevauchent ne lisent ni n'enfilent deux fois.
      const locked = await withRoleCreationLock({ guildId: "booster-sync", key: "all", waitMs: 0, run: () => runBoosterSync() });
      if (locked.status === "busy") {
        logger.info("cron:booster-sync", "Passage déjà en cours : ignoré.");
        return;
      }
      logger.info("cron:booster-sync", `fin durée=${Date.now() - startedAt} ms.`, { ...locked.value });
    } catch (error) {
      logger.error("cron:booster-sync", error, { durationMs: Date.now() - startedAt });
    }
  });
  return NextResponse.json({ status: "accepted" }, { status: 202 });
}
