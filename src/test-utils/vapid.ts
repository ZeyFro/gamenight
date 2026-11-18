import type { ECDH } from "node:crypto";

/** Encodage de paires éphémères uniquement utilisées par les tests. */
export function encodeVapidFixture(vapid: ECDH) {
  return { publicKey: vapid.getPublicKey().toString("base64url"), privateKey: Buffer.from(vapid.getPrivateKey().toString("hex").padStart(64, "0"), "hex").toString("base64url") };
}
