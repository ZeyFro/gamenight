import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), change: vi.fn(), rate: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: mocks.user } } }));
vi.mock("@/lib/session-seats", () => ({ changeSessionSeat: mocks.change }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, RATE_LIMIT_MESSAGE: "Doucement !" }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import { respondToSessionRsvp } from "./discord-session-rsvp";
const origin = { interactionId: "100", discordId: "777", guildId: "111", channelId: "222", messageId: "333" };
describe("réponse Discord à une soirée", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "actor" }); mocks.rate.mockReturnValue(true); mocks.change.mockResolvedValue({ ok: true, status: "CONFIRMED" }); });
  afterEach(() => vi.restoreAllMocks());
  it("utilise le compte Discord signé, pas une identité dans le bouton, et actualise le site", async () => {
    expect(await respondToSessionRsvp("s", "join", origin)).toContain("confirmée");
    expect(mocks.user).toHaveBeenCalledWith({ where: { discordId: "777" }, select: { id: true } });
    expect(mocks.change).toHaveBeenCalledWith("actor", "s", { kind: "join" }, origin);
    expect(mocks.revalidate).toHaveBeenCalledWith("/sessions/s");
  });
  it("explique l'attente puis le désistement, sans promettre de MP", async () => {
    mocks.change.mockResolvedValue({ ok: true, status: "WAITLIST" }); expect(await respondToSessionRsvp("s", "join", origin)).toContain("liste d’attente");
    expect(await respondToSessionRsvp("s", "leave", origin)).toContain("Désistement");
  });
  it("compte absent ou spam : aucune mutation", async () => {
    mocks.user.mockResolvedValue(null); expect(await respondToSessionRsvp("s", "join", origin)).toContain("Connecte-toi");
    expect(mocks.change).not.toHaveBeenCalled();
    mocks.user.mockResolvedValue({ id: "actor" }); mocks.rate.mockReturnValue(false); expect(await respondToSessionRsvp("s", "join", origin)).toBe("Doucement !"); expect(mocks.change).not.toHaveBeenCalled();
  });
  it("retry déjà traité : confirmation neutre, sans annoncer un état devenu ancien", async () => {
    mocks.change.mockResolvedValue({ ok: true, status: "CONFIRMED", replayed: true });
    expect(await respondToSessionRsvp("s", "join", origin)).toContain("déjà été traitée");
  });
  it.each(["access", "closed", "disabled"])("échec %s : message explicite, aucune invalidation", async error => {
    mocks.change.mockResolvedValue({ ok: false, error });
    const content = await respondToSessionRsvp("s", "join", origin);
    expect(content.length).toBeGreaterThan(20); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
