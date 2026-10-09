import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), mutate: vi.fn(), rate: vi.fn(), revalidate: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/session-seats", () => ({ changeSessionSeat: mocks.mutate }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/logger", () => ({ logger: { error: mocks.log } }));
import { sessionSeatAction } from "./seats";
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ id: "me" }); mocks.rate.mockReturnValue(true); mocks.mutate.mockResolvedValue({ ok: true, status: "CONFIRMED" }); });
it("refuse une connexion absente ou forcée sans effectuer de mutation", async () => {
  mocks.user.mockResolvedValue(null);
  expect(await sessionSeatAction({ sessionId: "s", command: { kind: "join" } })).toEqual({ ok: false, error: "authentication" });
  expect(mocks.user).toHaveBeenCalledWith({ recordActivity: false }); expect(mocks.mutate).not.toHaveBeenCalled();
});
it("valide les limites et bloque le rate limit avant la transaction", async () => {
  for (const command of [{ kind: "capacity", capacity: 0 }, { kind: "capacity", capacity: 101 }, { kind: "capacity", capacity: 1.5 }, { kind: "forged" }]) expect((await sessionSeatAction({ sessionId: "s", command })).ok).toBe(false);
  mocks.rate.mockReturnValue(false);
  expect(await sessionSeatAction({ sessionId: "s", command: { kind: "join" } })).toEqual({ ok: false, error: "rate_limited" }); expect(mocks.mutate).not.toHaveBeenCalled();
});
it("prend l'identité de la session et actualise seulement après réussite", async () => {
  await sessionSeatAction({ sessionId: "s", userId: "victim", command: { kind: "leave" } });
  expect(mocks.mutate).toHaveBeenCalledWith("me", "s", { kind: "leave" }); expect(mocks.revalidate).toHaveBeenCalledWith("/sessions/s");
  mocks.revalidate.mockClear(); mocks.mutate.mockResolvedValue({ ok: false, error: "access" });
  await sessionSeatAction({ sessionId: "s", command: { kind: "join" } }); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it("retourne une erreur récupérable et journalise une transaction échouée", async () => {
  mocks.mutate.mockRejectedValue(new Error("database"));
  expect(await sessionSeatAction({ sessionId: "s", command: { kind: "join" } })).toEqual({ ok: false, error: "unavailable" }); expect(mocks.log).toHaveBeenCalledOnce();
});
