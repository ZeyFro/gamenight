import { createPublicKey, verify } from "node:crypto";

/**
 * Vérification de la signature Ed25519 d'un événement webhook Discord (même
 * schéma que les Interactions) : `X-Signature-Ed25519` est la signature, en
 * hexadécimal, de `X-Signature-Timestamp` concaténé au corps BRUT de la
 * requête ; la clé est la clé publique de l'application (portail développeur,
 * 32 octets en hexadécimal). Node sait vérifier Ed25519 nativement : aucune
 * dépendance.
 */

// SPKI DER d'une clé publique Ed25519 = ce préfixe de 12 octets + la clé brute.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const HEX = /^[0-9a-f]+$/i;
const PUBLIC_KEY_HEX_LENGTH = 64;
const SIGNATURE_HEX_LENGTH = 128;

export interface DiscordSignatureInput {
  publicKeyHex: string;
  signatureHex: string | null;
  timestamp: string | null;
  rawBody: string;
}

/** `true` seulement si la signature est valide ; tout le reste (en-tête absent, hexadécimal invalide, mauvaise longueur) vaut `false`, sans exception. */
export function verifyDiscordSignature(input: DiscordSignatureInput): boolean {
  const { publicKeyHex, signatureHex, timestamp, rawBody } = input;
  if (!signatureHex || !timestamp) return false;
  if (publicKeyHex.length !== PUBLIC_KEY_HEX_LENGTH || !HEX.test(publicKeyHex)) return false;
  if (signatureHex.length !== SIGNATURE_HEX_LENGTH || !HEX.test(signatureHex)) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return verify(null, Buffer.from(timestamp + rawBody), key, Buffer.from(signatureHex, "hex"));
  } catch {
    // Contrat de la fonction : une clé que Node refuse de charger est une
    // vérification échouée, jamais une exception remontée à la route.
    return false;
  }
}
