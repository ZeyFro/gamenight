import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), load: vi.fn(), limit: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.current }));
vi.mock("@/lib/session-slot-data", () => ({ loadSessionSlotSuggestions: mocks.load }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.limit }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.log } }));
import { suggestSessionSlotsAction } from "./suggest-slots";

describe("suggestion de créneaux : action en lecture seule", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.current.mockResolvedValue({ id: "host" }); mocks.limit.mockReturnValue(true); mocks.load.mockResolvedValue({ ok: true, suggestions: [] }); });
  it("session absente ou invalidée : aucune lecture de disponibilités", async () => {
    mocks.current.mockResolvedValue(null);
    expect(await suggestSessionSlotsAction({ guestIds: [], durationMinutes: 120 })).toEqual({ ok: false, error: "authentication" });
    expect(mocks.current).toHaveBeenCalledWith({ recordActivity: false });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it.each([{}, { guestIds: [42], durationMinutes: 120 }, { guestIds: ["a"], durationMinutes: 999 }, { guestIds: Array(1001).fill("a"), durationMinutes: 120 }])("refuse une entrée manipulée avant toute recherche : %j", async (input) => {
    expect(await suggestSessionSlotsAction(input)).toEqual({ ok: false, error: "invalid_input" });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("limite les recherches et ne touche pas les disponibilités si la limite est atteinte", async () => {
    mocks.limit.mockReturnValue(false);
    expect(await suggestSessionSlotsAction({ guestIds: ["a"], durationMinutes: 120 })).toEqual({ ok: false, error: "rate_limited" });
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("l'identité de l'organisateur vient de la session, jamais de l'entrée", async () => {
    await suggestSessionSlotsAction({ creatorId: "foreign", guestIds: ["a"], durationMinutes: 120 });
    expect(mocks.load).toHaveBeenCalledWith("host", ["a"], 120, expect.any(Date));
  });
  it("une erreur de base est journalisée et renvoyée sans détail interne", async () => {
    mocks.load.mockRejectedValue(new Error("private database details"));
    expect(await suggestSessionSlotsAction({ guestIds: [], durationMinutes: 120 })).toEqual({ ok: false, error: "unavailable" });
    expect(mocks.log).toHaveBeenCalledOnce();
  });
});
