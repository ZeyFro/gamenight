import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  sendSessionReminder,
  REMINDER_WINDOW_HOURS,
  type ReminderWindow,
} from "@/lib/discord-reminder";

function parseRemindersSent(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

/**
 * Route déclenchée par Vercel Cron toutes les 15 min (voir `vercel.json`)
 * — un seul cron (limite du plan Hobby), les fenêtres 24h/2h sont gérées
 * ici plutôt que par plusieurs crons. Si `CRON_SECRET` est configurée, on
 * exige l'en-tête que Vercel Cron envoie automatiquement, pour éviter
 * qu'un tiers déclenche des rappels en tapant l'URL. Sans Vercel Cron
 * configuré (déploiement hors Vercel, ou cron non activé), personne
 * n'appelle jamais cette route : aucun rappel ne part, mais rien ne
 * plante ailleurs dans l'app — dégradation silencieuse, comme pour
 * DISCORD_WEBHOOK_URL non configurée (F6).
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
  const sessions = await prisma.session.findMany({
    where: { status: "SCHEDULED", decidedGameId: { not: null }, date: { gt: now } },
    include: { decidedGame: true },
  });

  const sent: string[] = [];

  for (const session of sessions) {
    const hoursUntil = (session.date.getTime() - now.getTime()) / 3_600_000;
    const remindersSent = parseRemindersSent(session.remindersSent);
    const windowsDue = (
      Object.keys(REMINDER_WINDOW_HOURS) as ReminderWindow[]
    ).filter(
      (window) =>
        hoursUntil <= REMINDER_WINDOW_HOURS[window] &&
        !remindersSent.includes(window)
    );

    for (const window of windowsDue) {
      const result = await sendSessionReminder(session, window);
      if (!result.ok) {
        console.error(
          `[cron/reminders] Échec rappel ${window} pour la session ${session.id}: ${result.error}`
        );
      }
      remindersSent.push(window);
      sent.push(`${session.id}:${window}`);
    }

    if (windowsDue.length > 0) {
      await prisma.session.update({
        where: { id: session.id },
        data: { remindersSent },
      });
    }
  }

  return NextResponse.json({ checked: sessions.length, sent });
}
