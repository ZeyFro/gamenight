import { createECDH } from "node:crypto";
import { expect, it } from "vitest";
import { encodeVapidFixture } from "@/test-utils/vapid";

it("encode un scalaire court sur 32 octets sans changer sa paire P-256", () => {
  const fixture = createECDH("prime256v1");
  fixture.setPrivateKey(Buffer.from([1])); // Scalaire public fictif, jamais une clé de déploiement.
  const encoded = encodeVapidFixture(fixture);
  const privateBytes = Buffer.from(encoded.privateKey, "base64url");
  expect(privateBytes).toEqual(Buffer.concat([Buffer.alloc(31), Buffer.from([1])]));
  const restored = createECDH("prime256v1");
  restored.setPrivateKey(privateBytes);
  expect(restored.getPublicKey()).toEqual(Buffer.from(encoded.publicKey, "base64url"));
});
