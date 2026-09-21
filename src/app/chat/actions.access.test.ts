import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  checkRateLimit,
  chatMessageFindUnique,
  chatReactionFindUnique,
  chatReactionUpsert,
  chatMessageCreate,
  getChatMessages,
  canAccessSession,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  chatMessageFindUnique: vi.fn(),
  chatReactionFindUnique: vi.fn(),
  chatReactionUpsert: vi.fn(),
  chatMessageCreate: vi.fn(),
  getChatMessages: vi.fn(),
  canAccessSession: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit, RATE_LIMIT_ERROR_KEY: "rate_limited" }));
vi.mock("@/lib/chat", () => ({ getChatMessages }));
vi.mock("@/lib/session-access", () => ({ canAccessSession }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    chatMessage: { findUnique: chatMessageFindUnique, create: chatMessageCreate },
    chatReaction: { findUnique: chatReactionFindUnique, delete: vi.fn(), upsert: chatReactionUpsert },
  },
}));

import { getChatMessagesAction, sendChatMessageAction, toggleReactionAction } from "./actions";

/**
 * Chantier confidentialité des soirées — le chat rattaché à une soirée
 * (`sessionId` non nul) est réservé au créateur et aux invités actifs ;
 * le canal GLOBAL (`sessionId: null`) reste ouvert à tous, inchangé.
 * `getChatMessagesAction` est interrogée par polling direct depuis le
 * client toutes les 10s — la vérification doit donc avoir lieu à CHAQUE
 * appel, pas seulement au chargement de la page qui héberge le chat.
 */
describe("actions de chat — canal de soirée réservé aux invités actifs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
  });

  it("getChatMessagesAction : canal global (sessionId null) reste accessible à tout utilisateur connecté", async () => {
    getCurrentUser.mockResolvedValue({ id: "quiconque" });
    getChatMessages.mockResolvedValue([]);

    const result = await getChatMessagesAction(null);

    expect(canAccessSession).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it("getChatMessagesAction : canal de soirée refusé à un non-invité (sessionId réel et valide)", async () => {
    getCurrentUser.mockResolvedValue({ id: "non-invite" });
    canAccessSession.mockResolvedValue(false);

    const result = await getChatMessagesAction("session-reelle");

    expect(canAccessSession).toHaveBeenCalledWith("non-invite", "session-reelle");
    expect(getChatMessages).not.toHaveBeenCalled();
    // `null` — jamais un tableau vide qui laisserait croire "chat vide"
    // plutôt que "accès refusé", même contrat que "non connecté".
    expect(result).toBeNull();
  });

  it("getChatMessagesAction : canal de soirée accessible à un invité actif", async () => {
    getCurrentUser.mockResolvedValue({ id: "invite-actif" });
    canAccessSession.mockResolvedValue(true);
    getChatMessages.mockResolvedValue([{ id: "msg-1" }]);

    const result = await getChatMessagesAction("session-reelle");
    expect(result).toEqual([{ id: "msg-1" }]);
  });

  it("sendChatMessageAction : refuse un envoi vers une soirée à laquelle l'appelant n'a pas accès", async () => {
    getCurrentUser.mockResolvedValue({ id: "non-invite" });
    canAccessSession.mockResolvedValue(false);

    const fd = new FormData();
    fd.set("content", "salut");
    fd.set("sessionId", "session-reelle");
    const result = await sendChatMessageAction(fd);

    expect(chatMessageCreate).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false });
  });

  it("sendChatMessageAction : autorise un envoi vers le canal global sans vérification de session", async () => {
    getCurrentUser.mockResolvedValue({ id: "quiconque" });
    chatMessageCreate.mockResolvedValue({});

    const fd = new FormData();
    fd.set("content", "salut");
    fd.set("sessionId", "");
    const result = await sendChatMessageAction(fd);

    expect(canAccessSession).not.toHaveBeenCalled();
    expect(chatMessageCreate).toHaveBeenCalled();
    expect(result).toEqual({ ok: true });
  });

  it("toggleReactionAction : refuse une réaction sur un message d'une soirée à laquelle l'appelant n'a pas accès", async () => {
    getCurrentUser.mockResolvedValue({ id: "non-invite" });
    chatMessageFindUnique.mockResolvedValue({ id: "msg-1", sessionId: "session-reelle" });
    canAccessSession.mockResolvedValue(false);

    const fd = new FormData();
    fd.set("messageId", "msg-1");
    fd.set("emoji", "👍");
    await toggleReactionAction(fd);

    expect(chatReactionUpsert).not.toHaveBeenCalled();
  });
});
