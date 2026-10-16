import { beforeEach, afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: vi.fn(), change: vi.fn(), rate: vi.fn(), refresh: vi.fn(), log: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: m.user }));
vi.mock("@/lib/session-preparation", async original => ({ ...await original<typeof import("@/lib/session-preparation")>(), changeSessionPreparation: m.change }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: m.rate }));
vi.mock("next/cache", () => ({ revalidatePath: m.refresh }));
vi.mock("@/lib/logger", () => ({ logger: { error: m.log } }));
import { sessionPreparationAction } from "./preparation";
const input = { sessionId: "s", field: "installed", checked: true };
beforeEach(() => { vi.resetAllMocks(); m.user.mockResolvedValue({ id: "me" }); m.rate.mockReturnValue(true); m.change.mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());
it("l'identité vient exclusivement de la connexion", async () => {
  expect(await sessionPreparationAction({ ...input, userId: "victim" })).toEqual({ ok: false }); expect(m.change).not.toHaveBeenCalled();
  expect(await sessionPreparationAction(input)).toEqual({ ok: true }); expect(m.change).toHaveBeenCalledWith("me", input);
  expect(m.refresh).toHaveBeenCalledWith("/sessions/s");
});
it("refuse déconnexion et limitation sans écriture", async () => {
  m.user.mockResolvedValueOnce(null); expect(await sessionPreparationAction(input)).toEqual({ ok: false });
  m.rate.mockReturnValue(false); expect(await sessionPreparationAction(input)).toEqual({ ok: false }); expect(m.change).not.toHaveBeenCalled();
});
it("ne rafraîchit pas après refus et journalise les erreurs", async () => {
  m.change.mockResolvedValueOnce(false); expect(await sessionPreparationAction(input)).toEqual({ ok: false }); expect(m.refresh).not.toHaveBeenCalled();
  m.change.mockRejectedValueOnce(new Error("database")); expect(await sessionPreparationAction(input)).toEqual({ ok: false }); expect(m.log).toHaveBeenCalledOnce();
});
