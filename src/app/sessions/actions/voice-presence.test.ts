import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  grant: vi.fn(),
  withdraw: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/session-voice-presence", () => ({
  grantSessionVoiceConsent: mocks.grant,
  withdrawSessionVoiceConsent: mocks.withdraw,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import { grantVoicePresenceConsentAction, withdrawVoicePresenceConsentAction } from "./voice-presence";

function form(sessionId: string) {
  const data = new FormData();
  data.set("sessionId", sessionId);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
  mocks.getCurrentUser.mockResolvedValue({ id: "user-1" });
  mocks.grant.mockResolvedValue(true);
  mocks.withdraw.mockResolvedValue(true);
});

describe("session voice consent actions", () => {
  it("only records opt-in after the feature is enabled and revalidates the session", async () => {
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "false");
    await expect(grantVoicePresenceConsentAction(form("session-1"))).rejects.toThrow("redirect:/sessions/session-1?voice=disabled");
    expect(mocks.grant).not.toHaveBeenCalled();

    vi.stubEnv("VOICE_PRESENCE_ENABLED", "true");
    await expect(grantVoicePresenceConsentAction(form("session-1"))).rejects.toThrow("redirect:/sessions/session-1?voice=consented");
    expect(mocks.grant).toHaveBeenCalledWith("session-1", "user-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sessions/session-1");
  });

  it("allows withdrawal even while collection is disabled", async () => {
    vi.stubEnv("VOICE_PRESENCE_ENABLED", "false");
    await expect(withdrawVoicePresenceConsentAction(form("session-1"))).rejects.toThrow("redirect:/sessions/session-1?voice=withdrawn");
    expect(mocks.withdraw).toHaveBeenCalledWith("session-1", "user-1");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/sessions/session-1");
  });

  it("requires a signed-in user before changing consent", async () => {
    mocks.getCurrentUser.mockResolvedValue(null);
    await expect(withdrawVoicePresenceConsentAction(form("session-1"))).rejects.toThrow("redirect:/");
    expect(mocks.withdraw).not.toHaveBeenCalled();
  });
});
