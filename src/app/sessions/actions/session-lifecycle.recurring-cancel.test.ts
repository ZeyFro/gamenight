import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentUser, checkRateLimit, cancelRecurringSessions, cancelSession, closeSession, markSessionDone, resendSessionAnnouncement, updateSessionSchedule, revalidatePath, redirect } = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  cancelRecurringSessions: vi.fn(),
  cancelSession: vi.fn(),
  closeSession: vi.fn(),
  markSessionDone: vi.fn(),
  resendSessionAnnouncement: vi.fn(),
  updateSessionSchedule: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit }));
vi.mock("@/lib/sessions", () => ({
  cancelRecurringSessions,
  cancelSession,
  closeSession,
  markSessionDone,
  resendSessionAnnouncement,
  updateSessionSchedule,
}));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

import { cancelRecurringSessionsAction } from "./session-lifecycle";

describe("cancelRecurringSessionsAction", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SERIES_CANCEL_ENABLED", "true");
    vi.clearAllMocks();
    checkRateLimit.mockReturnValue(true);
  });
  afterEach(() => vi.unstubAllEnvs());

  function form(sessionId = "session-1") {
    const data = new FormData();
    data.set("sessionId", sessionId);
    return data;
  }

  it("returns a visible error while the feature flag is off", async () => {
    vi.stubEnv("SESSION_SERIES_CANCEL_ENABLED", "false");
    await expect(cancelRecurringSessionsAction({ error: null }, form())).resolves.toEqual({ error: "L’annulation groupée est désactivée." });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("requires a signed-in creator and applies the rate limit before cancellation", async () => {
    getCurrentUser.mockResolvedValue(null);
    await expect(cancelRecurringSessionsAction({ error: null }, form())).resolves.toEqual({ error: "Connecte-toi pour annuler cette série." });

    getCurrentUser.mockResolvedValue({ id: "owner" });
    checkRateLimit.mockReturnValue(false);
    await expect(cancelRecurringSessionsAction({ error: null }, form())).resolves.toEqual({ error: "Trop de demandes. Réessaie dans un instant." });
    expect(cancelRecurringSessions).not.toHaveBeenCalled();
  });

  it("does not expose or cancel a series the creator cannot access", async () => {
    getCurrentUser.mockResolvedValue({ id: "owner" });
    cancelRecurringSessions.mockResolvedValue(null);
    await expect(cancelRecurringSessionsAction({ error: null }, form())).resolves.toEqual({ error: "Cette série est inaccessible." });
    expect(cancelRecurringSessions).toHaveBeenCalledWith("session-1", "owner");
  });

  it("redirects after an authorized cancellation, even when no future occurrence remains", async () => {
    getCurrentUser.mockResolvedValue({ id: "owner" });
    cancelRecurringSessions.mockResolvedValue([]);
    await expect(cancelRecurringSessionsAction({ error: null }, form())).rejects.toThrow("REDIRECT:/sessions");
    expect(revalidatePath).toHaveBeenCalledWith("/sessions/session-1");
    expect(revalidatePath).toHaveBeenCalledWith("/sessions");
    expect(revalidatePath).toHaveBeenCalledWith("/calendrier");
  });
});
