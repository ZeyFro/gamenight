import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  checkRateLimit,
  redirect,
  revalidatePath,
  sessionFindUnique,
  sessionDelete,
  galleryMediaFindMany,
  deleteSessionGalleryBlobs,
  queryRaw,
  transactionFn,
  enqueueSessionThreadDelete,
  transactionCommitted,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  revalidatePath: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionDelete: vi.fn(),
  galleryMediaFindMany: vi.fn(),
  deleteSessionGalleryBlobs: vi.fn(),
  queryRaw: vi.fn(),
  transactionFn: vi.fn(),
  enqueueSessionThreadDelete: vi.fn(),
  transactionCommitted: { value: false },
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/admin", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/session-schedule", () => ({ resolveSessionSchedule: vi.fn() }));
vi.mock("@/lib/discord-session-created", () => ({ announceSessionCreated: vi.fn() }));
vi.mock("@/lib/discord-session-modified", () => ({ announceSessionModified: vi.fn() }));
vi.mock("@/lib/discord-bot-config", () => ({ isSessionAnnounceViaBotEnabled: vi.fn(() => false) }));
vi.mock("@/lib/discord", () => ({ isRealDiscordFailure: vi.fn(() => false) }));
vi.mock("@/lib/session-announce", () => ({
  enqueueSessionCreationDeliveries: vi.fn(),
  enqueueSessionInviteSyncForNewInvite: vi.fn(),
  enqueueSessionInviteSyncForNewInvites: vi.fn(),
  enqueueSessionThreadDelete,
}));
vi.mock("@/lib/session-gallery", () => ({ deleteSessionGalleryBlobs }));
vi.mock("@/lib/xp-actions", () => ({ awardXp: vi.fn() }));
vi.mock("@/lib/sessions", () => ({
  cancelSession: vi.fn(),
  closeSession: vi.fn(),
  markSessionDone: vi.fn(),
  resendSessionAnnouncement: vi.fn(),
  updateSessionSchedule: vi.fn(),
}));
vi.mock("@/lib/badges", () => ({ checkSessionsCreatedBadges: vi.fn() }));
vi.mock("@/lib/reminder-timings", () => ({ parseReminderTimingsFromFormData: vi.fn() }));
vi.mock("@/lib/notify-recipients", () => ({ parseNotifyRecipientsFromFormData: vi.fn() }));
vi.mock("@/lib/session-access", () => ({ inviteToSession: vi.fn() }));
vi.mock("@/lib/validations", () => ({
  createSessionSchema: {},
  editSessionSchema: {},
  VALIDATION_ERROR_KEY: "validation",
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: sessionFindUnique, delete: sessionDelete },
    $transaction: transactionFn,
  },
}));

vi.mock("@/lib/community-scoped-client", () => ({
  getScopedPrisma: async () => ({ session: { findUnique: sessionFindUnique } }),
}));

import { deleteSessionAction } from "./session-lifecycle";

/**
 * Chantier nettoyage réel du stockage (V2) — `deleteSessionAction` reste
 * une fine enveloppe autour de la mutation métier (la logique de
 * suppression Discord elle-même — races, idempotence, compensation — est
 * couverte contre une vraie base Postgres + Discord simulé dans
 * `session-announce.integration.test.ts`, describe "V2 — suppression
 * manuelle définitive du fil privé") : ces tests vérifient uniquement le
 * comportement PROPRE à l'action serveur — autorisation créateur,
 * `enqueueSessionThreadDelete` déclenché UNIQUEMENT si `announceViaBot`,
 * que l'enqueue et la suppression de la ligne `Session` vivent DANS LA
 * MÊME TRANSACTION, et que la suppression externe des Blob a lieu APRÈS
 * le commit de la transaction.
 */
describe("deleteSessionAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
    // Simule `prisma.$transaction(async (tx) => ...)` — exécute le
    // callback avec un `tx` factice exposant les mêmes méthodes mockées,
    // pour observer que les DEUX opérations passent bien par LUI.
    transactionFn.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => {
      const result = await callback({
        $queryRaw: queryRaw.mockResolvedValue([]),
        session: { delete: sessionDelete },
        sessionGalleryMedia: { findMany: galleryMediaFindMany.mockResolvedValue([]) },
      });
      transactionCommitted.value = true;
      return result;
    });
    transactionCommitted.value = false;
    deleteSessionGalleryBlobs.mockImplementation(async () => {
      expect(transactionCommitted.value).toBe(true);
    });
  });

  function formData(sessionId: string): FormData {
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    return fd;
  }

  it("refuse sans session utilisateur — jamais de lecture ni de suppression", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(deleteSessionAction(formData("s1"))).rejects.toThrow("REDIRECT:/");
    expect(sessionFindUnique).not.toHaveBeenCalled();
  });

  it("id de session vide (formulaire forgé) — jamais transmis plus loin", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    await deleteSessionAction(formData(""));
    expect(sessionFindUnique).not.toHaveBeenCalled();
  });

  it("non-créateur — aucune suppression, aucun enqueue Discord", async () => {
    getCurrentUser.mockResolvedValue({ id: "pas-le-createur" });
    sessionFindUnique.mockResolvedValue({ createdById: "createur-1", announceViaBot: true });

    await deleteSessionAction(formData("session-1"));

    expect(transactionFn).not.toHaveBeenCalled();
    expect(enqueueSessionThreadDelete).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("créateur, announceViaBot=true : enqueue le nettoyage du fil PUIS supprime la session, DANS LA MÊME TRANSACTION", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    sessionFindUnique.mockResolvedValue({ createdById: "createur-1", announceViaBot: true });

    await expect(deleteSessionAction(formData("session-1"))).rejects.toThrow("REDIRECT:/sessions");

    expect(transactionFn).toHaveBeenCalledTimes(1);
    expect(deleteSessionGalleryBlobs).toHaveBeenCalledWith([]);
    expect(transactionCommitted.value).toBe(true);
    expect(enqueueSessionThreadDelete).toHaveBeenCalledWith("session-1", expect.anything());
    expect(sessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
    // Ordre : l'enqueue AVANT la suppression (jamais l'inverse — voir le
    // commentaire de fonction, deleteSessionAction).
    const enqueueOrder = enqueueSessionThreadDelete.mock.invocationCallOrder[0];
    const deleteOrder = sessionDelete.mock.invocationCallOrder[0];
    expect(enqueueOrder).toBeLessThan(deleteOrder);
  });

  it("créateur, announceViaBot=false (chemin webhook) : supprime SANS jamais enqueue de nettoyage Discord — rien à nettoyer côté bot", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur-1" });
    sessionFindUnique.mockResolvedValue({ createdById: "createur-1", announceViaBot: false });

    await expect(deleteSessionAction(formData("session-1"))).rejects.toThrow("REDIRECT:/sessions");

    expect(enqueueSessionThreadDelete).not.toHaveBeenCalled();
    expect(sessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
  });
});
