import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { closeSession } from "@/lib/sessions";

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
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const now = new Date();
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
      console.log(
        `[cron/close-sessions] Session ${session.id} déjà clôturée par ailleurs — ignorée.`
      );
      continue;
    }

    closed.push(session.id);
    if (!result.discord.ok) {
      console.error(
        `[cron/close-sessions] Session ${session.id} clôturée, mais échec de l'annonce Discord: ${result.discord.error}`
      );
    } else {
      console.log(`[cron/close-sessions] Session ${session.id} clôturée et annoncée sur Discord.`);
    }
  }

  return NextResponse.json({ checked: dueSessions.length, closed, skipped });
}
