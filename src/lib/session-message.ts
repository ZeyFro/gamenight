import type { MessageCategory } from "@prisma/client";
import { pickMessageTemplate, substituteVariables } from "@/lib/message-templates";
import { formatDateFr, toTimeInputValue, wallClockNow } from "@/lib/wallclock";

export async function sessionMessage(session: {
  date: Date;
  customReminderMessage: string | null;
  createdById: string;
}, kind: "created" | "date" | "reminder", options: {
  creatorName: string;
  gameName?: string;
  recipientName?: string;
  previousDate?: Date;
}): Promise<string> {
  const vars = {
    date: formatDateFr(session.date), heure: toTimeInputValue(session.date),
    createur: options.creatorName,
    ancienne_date: options.previousDate ? formatDateFr(options.previousDate) : "le créneau précédent",
    ancienne_heure: options.previousDate ? toTimeInputValue(options.previousDate) : "l’heure précédente",
    jeu: options.gameName ?? "le jeu à choisir",
    pote: options.recipientName ?? "les invités",
  };
  const category: MessageCategory = kind === "created" ? "SESSION_CREATED"
    : kind === "date" ? "SESSION_MODIFIED"
    : (session.date.getTime() - wallClockNow().getTime()) / 60_000 < 180 ? "REMINDER_2H" : "REMINDER_24H";
  if (kind === "reminder" && session.customReminderMessage) {
    return substituteVariables(session.customReminderMessage, vars);
  }
  return pickMessageTemplate(category, vars);
}
