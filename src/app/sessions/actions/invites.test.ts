import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getCurrentUser,
  checkRateLimit,
  sessionFindUnique,
  inviteToSession,
  revokeSessionInvite,
  enqueueSessionInviteSync,
  sessionInviteFindUnique,
  redirect,
  revalidatePath,
} = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  sessionFindUnique: vi.fn(),
  inviteToSession: vi.fn(),
  revokeSessionInvite: vi.fn(),
  enqueueSessionInviteSync: vi.fn(),
  sessionInviteFindUnique: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    session: { findUnique: sessionFindUnique },
    sessionInvite: { findUnique: sessionInviteFindUnique },
  },
}));
vi.mock("@/lib/session-access", () => ({ inviteToSession, revokeSessionInvite }));
vi.mock("@/lib/session-announce", () => ({ enqueueSessionInviteSync }));

import { addSessionInviteAction, revokeSessionInviteAction } from "./invites";

/**
 * Chantier confidentialité des soirées — "seul le créateur gère les
 * invitations" : ces deux actions doivent refuser tout appelant qui
 * n'est pas EXACTEMENT `session.createdById`, même un invité par
 * ailleurs légitimement actif sur cette même soirée, même avec un
 * `sessionId` réel et valide.
 */
describe("addSessionInviteAction / revokeSessionInviteAction — réservées au créateur", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
  });

  function formData(sessionId: string, guestUserId: string): FormData {
    const fd = new FormData();
    fd.set("sessionId", sessionId);
    fd.set("guestUserId", guestUserId);
    return fd;
  }

  it("addSessionInviteAction : refuse sans session serveur", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(addSessionInviteAction(formData("s1", "guest"))).rejects.toThrow("REDIRECT:/");
    expect(inviteToSession).not.toHaveBeenCalled();
  });

  it("addSessionInviteAction : un invité ACTIF mais non-créateur ne peut inviter personne (id de session réel et valide)", async () => {
    getCurrentUser.mockResolvedValue({ id: "guest-actif" });
    sessionFindUnique.mockResolvedValue({ createdById: "vrai-createur", announceViaBot: false });

    await addSessionInviteAction(formData("session-reelle", "nouvel-invite"));

    expect(inviteToSession).not.toHaveBeenCalled();
    expect(enqueueSessionInviteSync).not.toHaveBeenCalled();
  });

  it("addSessionInviteAction : le créateur peut inviter — synchronisation Discord enqueue SEULEMENT si announceViaBot", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur" });
    sessionFindUnique.mockResolvedValue({ createdById: "createur", announceViaBot: true });
    inviteToSession.mockResolvedValue({ id: "invite-1" });

    await addSessionInviteAction(formData("session-1", "nouvel-invite"));

    expect(inviteToSession).toHaveBeenCalledWith("session-1", "createur", "nouvel-invite");
    expect(enqueueSessionInviteSync).toHaveBeenCalledWith("invite-1");
  });

  it("addSessionInviteAction : le créateur invite, mais la session est restée sur le chemin webhook — AUCUNE synchronisation Discord enqueue (rien à synchroniser, pas de fil privé)", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur" });
    sessionFindUnique.mockResolvedValue({ createdById: "createur", announceViaBot: false });
    inviteToSession.mockResolvedValue({ id: "invite-1" });

    await addSessionInviteAction(formData("session-1", "nouvel-invite"));

    expect(inviteToSession).toHaveBeenCalled();
    expect(enqueueSessionInviteSync).not.toHaveBeenCalled();
  });

  it("revokeSessionInviteAction : un non-créateur (id de session forgé volontairement inconnu) ne peut retirer personne", async () => {
    getCurrentUser.mockResolvedValue({ id: "pas-le-createur" });
    sessionFindUnique.mockResolvedValue(null); // session forgée/inexistante

    await revokeSessionInviteAction(formData("session-forgee", "victime"));

    expect(revokeSessionInvite).not.toHaveBeenCalled();
  });

  it("revokeSessionInviteAction : le créateur peut retirer — synchronisation Discord enqueue pour l'invitation désormais révoquée", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur" });
    sessionFindUnique.mockResolvedValue({ createdById: "createur", announceViaBot: true });
    revokeSessionInvite.mockResolvedValue(true);
    sessionInviteFindUnique.mockResolvedValue({ id: "invite-1" });

    await revokeSessionInviteAction(formData("session-1", "guest-a-retirer"));

    expect(revokeSessionInvite).toHaveBeenCalledWith("session-1", "guest-a-retirer", "createur");
    expect(enqueueSessionInviteSync).toHaveBeenCalledWith("invite-1");
  });

  it("revokeSessionInviteAction : révocation déjà faite (idempotence) — aucune synchronisation redondante enqueue", async () => {
    getCurrentUser.mockResolvedValue({ id: "createur" });
    sessionFindUnique.mockResolvedValue({ createdById: "createur", announceViaBot: true });
    revokeSessionInvite.mockResolvedValue(false); // déjà REVOKED, rien à faire

    await revokeSessionInviteAction(formData("session-1", "guest-deja-retire"));

    expect(enqueueSessionInviteSync).not.toHaveBeenCalled();
  });
});
