import { createECDH } from "node:crypto";
import { describe, expect, it } from "vitest";
import { webPushConfig, webPushConfigIssue } from "./web-push-config";

/**
 * Paires de clés FIXES. Une paire aléatoire échouait de temps en temps : `getPrivateKey()` renvoie
 * moins de 32 octets quand la clé commence par un octet nul, et la configuration refuse alors une
 * paire pourtant valide. Une clé privée de 32 octets identiques est valide pour P-256 et ne dépend
 * d'aucun hasard.
 */
function vapidPair(fill: number) {
  const ecdh = createECDH("prime256v1");
  const privateBytes = Buffer.alloc(32, fill);
  ecdh.setPrivateKey(privateBytes);
  return { publicKey: ecdh.getPublicKey().toString("base64url"), privateKey: privateBytes.toString("base64url") };
}

describe("configuration Web Push", () => {
  const pair = vapidPair(7);
  const configured = {
    WEB_PUSH_ENABLED: "true",
    WEB_PUSH_VAPID_SUBJECT: "mailto:admin@example.test",
    WEB_PUSH_VAPID_PUBLIC_KEY: pair.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: pair.privateKey,
  };

  it("reste désactivée par défaut, sans signaler d'erreur de configuration", () => {
    expect(webPushConfig({})).toBeNull();
    expect(webPushConfigIssue({})).toEqual({ code: "disabled", variables: [] });
    for (const value of ["false", "TRUE", "1", ""]) {
      expect(webPushConfig({ ...configured, WEB_PUSH_ENABLED: value })).toBeNull();
      expect(webPushConfigIssue({ ...configured, WEB_PUSH_ENABLED: value })?.code).toBe("disabled");
    }
  });

  it("nomme les variables absentes quand la fonction est allumée", () => {
    expect(webPushConfig({ ...configured, WEB_PUSH_VAPID_PRIVATE_KEY: "" })).toBeNull();
    expect(webPushConfigIssue({ WEB_PUSH_ENABLED: "true" })).toEqual({
      code: "incomplete",
      variables: ["WEB_PUSH_VAPID_SUBJECT", "WEB_PUSH_VAPID_PUBLIC_KEY", "WEB_PUSH_VAPID_PRIVATE_KEY"],
    });
  });

  it("refuse des clés invalides ou dépareillées, sans jamais citer leur valeur", () => {
    const other = vapidPair(9);
    const cases = [
      { ...configured, WEB_PUSH_VAPID_PUBLIC_KEY: "public", WEB_PUSH_VAPID_PRIVATE_KEY: "private-secret-value" },
      { ...configured, WEB_PUSH_VAPID_PRIVATE_KEY: other.privateKey },
      { ...configured, WEB_PUSH_VAPID_SUBJECT: "admin@example.test" },
    ];
    for (const env of cases) {
      const issue = webPushConfigIssue(env);
      expect(issue?.code).toBe("invalid");
      expect(webPushConfig(env)).toBeNull();
      expect(JSON.stringify(issue)).not.toContain("private-secret-value");
      expect(JSON.stringify(issue)).not.toContain(env.WEB_PUSH_VAPID_PRIVATE_KEY);
    }
    expect(webPushConfigIssue(cases[2])?.variables).toEqual(["WEB_PUSH_VAPID_SUBJECT"]);
  });

  it("ne retourne la configuration que lorsqu'elle est complète et cohérente", () => {
    expect(webPushConfigIssue(configured)).toBeNull();
    expect(webPushConfig(configured)).toEqual({
      subject: "mailto:admin@example.test",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    });
    expect(webPushConfig({ ...configured, WEB_PUSH_VAPID_SUBJECT: "https://gamenight.example" })).not.toBeNull();
  });
});
