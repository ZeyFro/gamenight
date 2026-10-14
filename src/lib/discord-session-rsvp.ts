import { prisma } from "@/lib/prisma";
import { changeSessionSeat, type DiscordSeatOrigin } from "@/lib/session-seats";
import { checkRateLimit, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import { revalidatePath } from "next/cache";

export async function respondToSessionRsvp(sessionId: string, kind: "join" | "leave", origin: DiscordSeatOrigin): Promise<string> {
  const actor = await prisma.user.findUnique({ where: { discordId: origin.discordId }, select: { id: true } });
  if (!actor) return "Connecte-toi d’abord à GameNight avec ce compte Discord, puis réessaie.";
  if (!checkRateLimit(actor.id, "discord-session-seat", { limit: 12 })) return RATE_LIMIT_MESSAGE;
  const result = await changeSessionSeat(actor.id, sessionId, { kind }, origin);
  if (!result.ok) {
    if (result.error === "closed") return "Les inscriptions sont closes : cette soirée a commencé ou est terminée.";
    if (result.error === "disabled") return "Les places ne sont pas activées pour cette soirée. Réponds depuis GameNight.";
    return "Cette invitation n’est plus accessible. Vérifie ton accès au serveur et à la soirée dans GameNight.";
  }
  revalidatePath(`/sessions/${sessionId}`);
  revalidatePath(`/sessions/${sessionId}/resultats`);
  revalidatePath("/sessions");
  if (result.replayed) return "Cette réponse a déjà été traitée. Consulte ton inscription actuelle dans GameNight.";
  if (kind === "leave") return "✅ Désistement enregistré. Si quelqu’un attendait, sa place est confirmée automatiquement.";
  return result.status === "CONFIRMED" ? "✅ Ta place est confirmée. À bientôt !" : "⏳ Tu es sur la liste d’attente. GameNight te notifiera quand une place se libère.";
}
