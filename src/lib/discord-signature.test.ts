import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyDiscordSignature } from "./discord-signature";

/**
 * Signature Ed25519 des événements webhook Discord (même schéma que les
 * Interactions) : `X-Signature-Ed25519` signe `X-Signature-Timestamp + corps
 * brut` avec la clé privée de l'application ; on vérifie avec sa clé publique
 * (hex, 32 octets). Aucune exception ne doit sortir : tout est `false`.
 */

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
// SPKI DER d'une clé Ed25519 = préfixe de 12 octets + clé brute de 32 octets.
const PUBLIC_HEX = publicKey.export({ type: "spki", format: "der" }).subarray(12).toString("hex");
const TIMESTAMP = "1700000000";
const BODY = JSON.stringify({ version: 1, type: 0 });
const signatureOf = (timestamp: string, body: string) =>
  sign(null, Buffer.from(timestamp + body), privateKey).toString("hex");

const valid = () => ({
  publicKeyHex: PUBLIC_HEX,
  signatureHex: signatureOf(TIMESTAMP, BODY),
  timestamp: TIMESTAMP,
  rawBody: BODY,
});

describe("verifyDiscordSignature", () => {
  it("signature valide : true", () => {
    expect(verifyDiscordSignature(valid())).toBe(true);
  });

  it("corps modifié : false", () => {
    expect(verifyDiscordSignature({ ...valid(), rawBody: BODY + " " })).toBe(false);
  });

  it("horodatage modifié : false", () => {
    expect(verifyDiscordSignature({ ...valid(), timestamp: "1700000001" })).toBe(false);
  });

  it("signée par une autre clé : false", () => {
    const other = generateKeyPairSync("ed25519");
    const signatureHex = sign(null, Buffer.from(TIMESTAMP + BODY), other.privateKey).toString("hex");
    expect(verifyDiscordSignature({ ...valid(), signatureHex })).toBe(false);
  });

  it.each([
    ["signature absente", { signatureHex: null }],
    ["horodatage absent", { timestamp: null }],
    ["signature vide", { signatureHex: "" }],
    ["signature non hexadécimale", { signatureHex: "zz".repeat(64) }],
    ["signature trop courte", { signatureHex: "ab".repeat(10) }],
    ["clé publique vide", { publicKeyHex: "" }],
    ["clé publique non hexadécimale", { publicKeyHex: "zz".repeat(32) }],
    ["clé publique de mauvaise longueur", { publicKeyHex: "ab".repeat(31) }],
  ])("%s : false, sans exception", (_label, patch) => {
    expect(verifyDiscordSignature({ ...valid(), ...patch })).toBe(false);
  });
});
