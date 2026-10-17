import { describe, expect, it } from "vitest";
import { webPushConfig } from "./web-push-config";

describe("configuration Web Push", () => {
  const configured = {
    WEB_PUSH_ENABLED: "true",
    WEB_PUSH_VAPID_SUBJECT: "mailto:admin@example.test",
    WEB_PUSH_VAPID_PUBLIC_KEY: "public",
    WEB_PUSH_VAPID_PRIVATE_KEY: "private",
  };

  it("reste désactivée par défaut et si une clé manque", () => {
    expect(webPushConfig({})).toBeNull();
    expect(webPushConfig({ ...configured, WEB_PUSH_ENABLED: "false" })).toBeNull();
    expect(webPushConfig({ ...configured, WEB_PUSH_VAPID_PRIVATE_KEY: "" })).toBeNull();
  });

  it("ne retourne la configuration que lorsqu'elle est explicitement complète", () => {
    expect(webPushConfig(configured)).toEqual({
      subject: "mailto:admin@example.test",
      publicKey: "public",
      privateKey: "private",
    });
  });
});
