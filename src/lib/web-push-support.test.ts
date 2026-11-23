import { describe, expect, it } from "vitest";
import { detectPushSupport, isIosDevice, type PushEnvironment } from "@/lib/web-push-support";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const base: PushEnvironment = { userAgent: DESKTOP, installed: false, hasServiceWorker: true, hasPushManager: true, hasNotification: true };

describe("detectPushSupport (notifications iPhone, audit 23/11/2026 : 2.5 et 2.6)", () => {
  it("iPhone dans Safari (hors écran d'accueil) : guide d'installation, même si PushManager est absent", () => {
    expect(detectPushSupport({ ...base, userAgent: IPHONE, hasPushManager: false, hasNotification: false })).toBe("ios_needs_install");
    expect(detectPushSupport({ ...base, userAgent: IPHONE })).toBe("ios_needs_install");
  });
  it("iPhone avec l'application installée : pris en charge", () => {
    expect(detectPushSupport({ ...base, userAgent: IPHONE, installed: true })).toBe("supported");
  });
  it("iPad récent (se présente comme un Mac tactile) : traité comme iOS", () => {
    expect(isIosDevice({ userAgent: DESKTOP, platform: "MacIntel", maxTouchPoints: 5 })).toBe(true);
    expect(isIosDevice({ userAgent: DESKTOP, platform: "MacIntel", maxTouchPoints: 0 })).toBe(false);
    expect(detectPushSupport({ ...base, platform: "MacIntel", maxTouchPoints: 5 })).toBe("ios_needs_install");
  });
  it("navigateur sans PushManager, service worker ou Notification : non pris en charge", () => {
    expect(detectPushSupport({ ...base, hasPushManager: false })).toBe("unsupported");
    expect(detectPushSupport({ ...base, hasServiceWorker: false })).toBe("unsupported");
    expect(detectPushSupport({ ...base, userAgent: ANDROID, hasNotification: false })).toBe("unsupported");
  });
  it("Android et ordinateur compatibles : pris en charge, sans passer par l'installation", () => {
    expect(detectPushSupport({ ...base, userAgent: ANDROID })).toBe("supported");
    expect(detectPushSupport(base)).toBe("supported");
  });
});
