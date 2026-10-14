"use server";

import { resumeCreation } from "@/lib/creation-resume";

import { creationKey } from "@/lib/creation-intent";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  changeInstantSessionGame,
  createInstantSession,
  endInstantSession,
  getInstantSessionView,
  joinInstantSession,
  leaveInstantSession,
  toInstantSessionViewDTO,
  type InstantSessionViewDTO,
} from "@/lib/instant-sessions";
import type { InstantSessionActionState } from "@/app/jouer-maintenant/action-state";
import { parseNotifyRecipientsFromFormData } from "@/lib/notify-recipients";
import {
  changeInstantSessionGameSchema,
  createInstantSessionSchema,
  idSchema,
  VALIDATION_ERROR_KEY,
} from "@/lib/validations";

/**
 * V2 — "Jouer maintenant". `createInstantSessionAction` navigue (nouvelle
 * page), même discipline `redirect`/`?error=` que `tournois/actions.ts`.
 * Les quatre autres (rejoindre/quitter/terminer/changer de jeu) restent
 * sur la MÊME page (détail, en polling live) — signature
 * `useActionState` (`(prevState, formData) => state`, jamais de
 * `redirect`), même contrat que `drawSessionGameAction`
 * (src/app/sessions/actions/draw.ts) : évite une navigation complète sur
 * une page qui s'actualise déjà toute seule, et donne à
 * `InstantSessionDetail` un état `pending`/`error` natif pour désactiver
 * le bouton pendant la soumission (empêche les doubles soumissions).
 */


export async function createInstantSessionAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const resumed = await resumeCreation(user.id, "INSTANT_SESSION", formData);
  if (resumed) redirect(resumed);
  if (!checkRateLimit(user.id, "createInstantSession")) {
    redirect(`/jouer-maintenant?error=${VALIDATION_ERROR_KEY}`);
  }

  const input = createInstantSessionSchema.safeParse({
    gameId: String(formData.get("gameId") ?? ""),
    notifyUserIds: parseNotifyRecipientsFromFormData(formData),
  });
  if (!input.success) {
    redirect(`/jouer-maintenant?error=${VALIDATION_ERROR_KEY}`);
  }
  const { gameId, notifyUserIds } = input.data;

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) redirect(`/jouer-maintenant?error=${VALIDATION_ERROR_KEY}`);

  // Filtre défensif — même garde que `createTournamentAction` : ne garde
  // que des ids qui correspondent réellement à un user existant, jamais
  // une liste d'accès (voir le commentaire de fichier de
  // `instant-session-announce.ts`).
  const notifiedUserIds = notifyUserIds.length
    ? (await prisma.user.findMany({ where: { id: { in: notifyUserIds } }, select: { id: true } })).map(
        (u) => u.id
      )
    : [];

  const result = await createInstantSession({ creatorId: user.id, gameId, notifiedUserIds, creationKey: creationKey(formData.get("creationKey"), true) });
  if (!result.ok) {
    redirect(`/jouer-maintenant?error=${result.reason}`);
  }

  revalidatePath("/jouer-maintenant");
  revalidatePath("/");
  redirect(`/jouer-maintenant/${result.instantSession.id}`);
}

/**
 * Lecture pure (aucune mutation) — appelée au chargement de la page ET en
 * polling 30s depuis `InstantSessionDetail` (client), même contrat que
 * `getChatMessagesAction` (chat/actions.ts) : réévalue l'AUTORISATION à
 * chaque appel (authentification obligatoire, jamais seulement au premier
 * chargement), et règle expiration/récompenses au passage (voir
 * `getInstantSessionView`) — le polling lui-même EST le mécanisme qui
 * détecte "en direct" le franchissement des 15 minutes.
 */
export async function getInstantSessionViewAction(
  instantSessionId: string
): Promise<InstantSessionViewDTO | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const view = await getInstantSessionView(instantSessionId, user.id);
  return view ? toInstantSessionViewDTO(view) : null;
}

export async function joinInstantSessionAction(
  _prevState: InstantSessionActionState,
  formData: FormData
): Promise<InstantSessionActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const parsed = idSchema.safeParse(String(formData.get("instantSessionId") ?? ""));
  if (!parsed.success) return { status: "error", errorReason: "validation" };
  const instantSessionId = parsed.data;

  if (!checkRateLimit(user.id, "joinInstantSession")) {
    return { status: "error", errorReason: "rate_limited" };
  }

  const result = await joinInstantSession(instantSessionId, user.id);
  revalidatePath(`/jouer-maintenant/${instantSessionId}`);
  revalidatePath("/jouer-maintenant");
  if (!result.ok) return { status: "error", errorReason: result.reason };
  return { status: "success" };
}

export async function leaveInstantSessionAction(
  _prevState: InstantSessionActionState,
  formData: FormData
): Promise<InstantSessionActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const parsed = idSchema.safeParse(String(formData.get("instantSessionId") ?? ""));
  if (!parsed.success) return { status: "error", errorReason: "validation" };
  const instantSessionId = parsed.data;

  if (!checkRateLimit(user.id, "leaveInstantSession")) {
    return { status: "error", errorReason: "rate_limited" };
  }

  const result = await leaveInstantSession(instantSessionId, user.id);
  revalidatePath(`/jouer-maintenant/${instantSessionId}`);
  revalidatePath("/jouer-maintenant");
  if (!result.ok) return { status: "error", errorReason: result.reason };
  return { status: "success" };
}

/**
 * Réservée au créateur — "si le créateur quitte, la session se termine
 * pour tous, APRÈS CONFIRMATION EXPLICITE" : la confirmation elle-même
 * est un geste d'interface (`EndInstantSessionDialog`), cette action
 * n'est jamais appelée sans qu'un dialogue de confirmation ait déjà été
 * validé côté client — le serveur revérifie tout de même l'identité du
 * créateur (`endInstantSession` refuse tout autre appelant), jamais une
 * confiance aveugle dans le fait que le bouton n'était visible qu'au
 * créateur.
 */
export async function endInstantSessionAction(
  _prevState: InstantSessionActionState,
  formData: FormData
): Promise<InstantSessionActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const parsed = idSchema.safeParse(String(formData.get("instantSessionId") ?? ""));
  if (!parsed.success) return { status: "error", errorReason: "validation" };
  const instantSessionId = parsed.data;

  if (!checkRateLimit(user.id, "endInstantSession")) {
    return { status: "error", errorReason: "rate_limited" };
  }

  const result = await endInstantSession(instantSessionId, user.id, "creator_left");
  revalidatePath(`/jouer-maintenant/${instantSessionId}`);
  revalidatePath("/jouer-maintenant");
  revalidatePath("/");
  if (!result.ok) return { status: "error", errorReason: result.reason };
  return { status: "success" };
}

export async function changeInstantSessionGameAction(
  _prevState: InstantSessionActionState,
  formData: FormData
): Promise<InstantSessionActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const input = changeInstantSessionGameSchema.safeParse({
    instantSessionId: String(formData.get("instantSessionId") ?? ""),
    gameId: String(formData.get("gameId") ?? ""),
  });
  if (!input.success) return { status: "error", errorReason: "validation" };
  const { instantSessionId, gameId } = input.data;

  if (!checkRateLimit(user.id, "changeInstantSessionGame")) {
    return { status: "error", errorReason: "rate_limited" };
  }

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { id: true } });
  if (!game) return { status: "error", errorReason: "validation" };

  const result = await changeInstantSessionGame(instantSessionId, user.id, gameId);
  revalidatePath(`/jouer-maintenant/${instantSessionId}`);
  revalidatePath("/jouer-maintenant");
  if (!result.ok) return { status: "error", errorReason: result.reason };
  return { status: "success" };
}
