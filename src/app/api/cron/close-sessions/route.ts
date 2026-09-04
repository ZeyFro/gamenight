import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { closeOverdueScheduledSessions, closeSession } from "@/lib/sessions";
import { processOpenRoulettes } from "@/lib/roulette";
import { ensureFirstSeasonExists } from "@/lib/seasons";
import { wallClockNow } from "@/lib/wallclock";
import { logger } from "@/lib/logger";

/**
 * Route destinée à être appelée toutes les 15 min par un cron externe
 * (ex. cron-job.org — même mécanisme que `/api/cron/reminders`, F7).
 *
 * Corrige le bug remonté en prod : la clôture d'une session (annonce
 * Discord "🎮 Soirée validée") était jusqu'ici entièrement "paresseuse"
 * (`closeSessionIfDue`, déclenchée uniquement quand quelqu'un charge `/`,
 * `/sessions` ou `/sessions/[id]`) — si personne n'ouvrait l'app après
 * l'heure de la session, la notif attendait le prochain visiteur, parfois
 * 1h+ plus tard. Cette route trouve les sessions `VOTING` dont le vote
 * est fermé (`votingDeadline`, ou à défaut `date`) et les clôture
 * immédiatement, sans attendre un chargement de page.
 *
 * Idempotent et concurrence-safe : réutilise `closeSession`
 * (`src/lib/sessions.ts`), qui réclame désormais la clôture par un
 * `updateMany` atomique conditionné sur `status: "VOTING"` — si
 * `closeSessionIfDue` (déclenchement paresseux, toujours en place comme
 * filet de sécurité) a déjà traité une session entre le `findMany`
 * ci-dessous et l'appel à `closeSession`, ce dernier renvoie simplement
 * `null` sans reposter sur Discord.
 *
 * Fix bug prod (cycle de vie des soirées, fin août 2026) : cette route
 * fait maintenant DEUX passes. D'abord `VOTING → SCHEDULED/CANCELLED`
 * (ci-dessus, avec le nouveau cas "0 votant → CANCELLED en silence", cf.
 * `closeSession`) ; ensuite `SCHEDULED → DONE`
 * (`closeOverdueScheduledSessions`), qui n'avait jusqu'ici AUCUN
 * déclenchement automatique (seulement le bouton manuel "Marquer comme
 * terminée") — une soirée décidée restait donc "Prévue" indéfiniment,
 * visible pour toujours dans "À venir" et capable de rafler "Prochaine
 * soirée" sur `/`. `wallClockNow()` (et non `new Date()` brut) partout
 * ici : les dates stockées représentent l'heure de Paris, pas un vrai
 * instant UTC (cf. `src/lib/wallclock.ts`) — comparer avec l'heure UTC
 * réelle du serveur décalait toutes ces clôtures de 1-2h (CET/CEST).
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Fix bug remonté (Saison 1 jamais créée au déploiement) — garde-fou
  // idempotent, voir le commentaire sur `ensureFirstSeasonExists`
  // (src/lib/seasons.ts). Best-effort : une panne ici ne doit jamais
  // empêcher la clôture des sessions, seule vraie responsabilité de ce cron.
  try {
    await ensureFirstSeasonExists();
  } catch (error) {
    logger.error("cron:close-sessions", error, { task: "ensureFirstSeasonExists" });
  }

  const now = wallClockNow();
  const dueSessions = await prisma.session.findMany({
    where: {
      status: "VOTING",
      OR: [{ votingDeadline: { lte: now } }, { votingDeadline: null, date: { lte: now } }],
    },
    select: { id: true, date: true },
  });

  const closed: string[] = [];
  const skipped: string[] = [];

  for (const session of dueSessions) {
    const result = await closeSession(session.id);
    if (!result) {
      // Déjà réclamée entretemps par closeSessionIfDue (course gagnée par
      // l'autre déclencheur) — pas une erreur, juste rien à faire de plus.
      skipped.push(session.id);
      logger.info(
        "cron:close-sessions",
        `Session ${session.id} déjà clôturée par ailleurs — ignorée.`
      );
      continue;
    }

    closed.push(session.id);
    if (!result.discord) {
      logger.info(
        "cron:close-sessions",
        `Session ${session.id} annulée en silence (0 votant) — pas d'annonce Discord.`
      );
    } else if (!result.discord.ok) {
      logger.error(
        "cron:close-sessions",
        `Session ${session.id} clôturée, mais échec de l'annonce Discord: ${result.discord.error}`,
        { sessionId: session.id }
      );
    } else {
      logger.info("cron:close-sessions", `Session ${session.id} clôturée et annoncée sur Discord.`);
    }
  }

  // Toujours APRÈS la clôture des votes ci-dessus : une soirée à 0 votant
  // vient de passer CANCELLED, donc ne peut plus apparaître dans la
  // requête SCHEDULED de closeOverdueScheduledSessions (cf. son
  // commentaire) — l'ordre des deux passes garantit qu'une soirée à 0
  // votant ne peut jamais atteindre DONE.
  const done = await closeOverdueScheduledSessions();
  if (done.length > 0) {
    logger.info(
      "cron:close-sessions",
      `${done.length} soirée(s) SCHEDULED passée(s) DONE (délai de grâce dépassé) : ${done.join(", ")}`
    );
  }

  // Roulette asynchrone (Sprint 3) — même cron, même logique de
  // déclenchement que la clôture de session ci-dessus : rappel (deadline
  // − 1h) puis tirage des roulettes `OPEN` dont la deadline est dépassée.
  // Voir `src/lib/roulette.ts` pour le détail (verrous atomiques, mêmes
  // mécaniques que `claimSessionClose`).
  const roulettes = await processOpenRoulettes();

  return NextResponse.json({ checked: dueSessions.length, closed, skipped, done, roulettes });
}
