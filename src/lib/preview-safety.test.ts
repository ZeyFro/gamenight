import { afterEach, describe, expect, it, vi } from "vitest";
import { isVercelPreview } from "./preview-safety";
import { checkCronAuth } from "./cron-auth";
import { postToDiscord } from "./discord";
import { sendChannelMessage } from "./discord-rest";

describe("Preview isolation", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("blocks cron even with a valid secret in Vercel Preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isVercelPreview()).toBe(true);
    expect(checkCronAuth("secret", "Bearer secret")).toEqual({ ok: false, status: 503 });
  });
  it("does not send a Discord webhook from Preview even if configured", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.com/api/webhooks/blocked");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    expect(await postToDiscord({ title: "blocked", color: 0 })).toEqual({ ok: false, error: "preview_blocked" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
  it("does not send a bot message from Preview even with a token", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("DISCORD_BOT_TOKEN", "not-used");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("must not fetch"));
    const result = await sendChannelMessage({
      channelId: "123456789012345678", content: "no", deadline: new Date(Date.now() + 10000),
    });
    expect(result).toMatchObject({ ok: false, kind: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
  it("does not change production cron authorization", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(checkCronAuth("secret", "Bearer secret")).toEqual({ ok: true });
  });
});
