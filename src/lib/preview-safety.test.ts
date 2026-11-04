import { afterEach, describe, expect, it, vi } from "vitest";
import { isVercelPreview } from "./preview-safety";
import { checkCronAuth } from "./cron-auth";

describe("Preview isolation", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("blocks cron even with a valid secret in Vercel Preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isVercelPreview()).toBe(true);
    expect(checkCronAuth("secret", "Bearer secret")).toEqual({ ok: false, status: 503 });
  });
  it("does not change production cron authorization", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(checkCronAuth("secret", "Bearer secret")).toEqual({ ok: true });
  });
});
