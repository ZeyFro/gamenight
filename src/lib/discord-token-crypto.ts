import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement au repos des jetons OAuth Discord (`User.discordAccessToken`/
 * `discordRefreshToken`) — AES-256-GCM, enveloppe versionnée et
 * authentifiée : `enc:v1:<iv base64>:<authTag base64>:<ciphertext base64>`.
 *
 * Clé dédiée (`DISCORD_TOKEN_ENCRYPTION_KEY`, base64, 32 octets décodés),
 * distincte de `AUTH_SECRET`/`CRON_SECRET`/`DATABASE_URL` — jamais
 * dérivée d'elles. IV aléatoire de 12 octets à CHAQUE chiffrement, jamais
 * réutilisé. La version ("v1") est passée en AAD (donnée additionnelle
 * authentifiée) : falsifier le segment de version sans casser le tag GCM
 * est impossible.
 *
 * Compat ascendante : toute valeur ne commençant PAS par `enc:` est traitée
 * comme un ancien jeton en clair ("legacy"), utilisable tel quel — mais
 * toute valeur commençant par `enc:` avec un format incorrect ou une
 * version inconnue est `invalid`, JAMAIS traitée comme legacy (parsing
 * strict : nombre de segments, alphabet base64, IV exactement 12 octets,
 * tag exactement 16 octets, ciphertext non vide).
 *
 * Aucune fonction ici ne journalise jamais le plaintext, le ciphertext, la
 * clé, l'IV ou le tag — voir les appelants (`auth.ts`, `discord-profile.ts`)
 * pour la politique de logs (catégorie générique uniquement).
 */

const ALGORITHM = "aes-256-gcm";
const KEY_ENV_VAR = "DISCORD_TOKEN_ENCRYPTION_KEY";
const KEY_BYTE_LENGTH = 32;
const IV_BYTE_LENGTH = 12;
const AUTH_TAG_BYTE_LENGTH = 16;
const VERSION = "v1";
const ENVELOPE_PREFIX = "enc:";
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export class DiscordTokenEncryptionKeyError extends Error {}

/**
 * Lit et valide `DISCORD_TOKEN_ENCRYPTION_KEY` — lève une erreur contrôlée
 * (nom de variable + longueur obtenue, jamais son contenu) si absente, pas
 * du Base64 valide, ou ne décodant pas en exactement 32 octets. À appeler
 * une seule fois par opération (pas par utilisateur dans une boucle) : voir
 * `refreshAllDiscordProfilesViaOAuth`.
 */
export function getEncryptionKey(): Buffer {
  const raw = process.env[KEY_ENV_VAR];
  if (!raw) {
    throw new DiscordTokenEncryptionKeyError(
      `${KEY_ENV_VAR} absente — configuration de chiffrement des jetons Discord manquante.`
    );
  }
  if (!BASE64_RE.test(raw)) {
    throw new DiscordTokenEncryptionKeyError(`${KEY_ENV_VAR} n'est pas du Base64 valide.`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTE_LENGTH) {
    throw new DiscordTokenEncryptionKeyError(
      `${KEY_ENV_VAR} doit décoder en exactement ${KEY_BYTE_LENGTH} octets (obtenu : ${key.length}).`
    );
  }
  return key;
}

/** `true` pour toute valeur ne commençant pas par le préfixe d'enveloppe — ancien jeton en clair. */
export function isLegacyToken(value: string): boolean {
  return !value.startsWith(ENVELOPE_PREFIX);
}

/** Chiffre `plaintext` avec `key` (32 octets) — IV aléatoire à chaque appel, jamais réutilisé. */
export function encryptToken(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(VERSION, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ["enc", VERSION, iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":"
  );
}

export type DecryptResult =
  | { status: "encrypted"; value: string }
  | { status: "legacy"; value: string }
  | { status: "invalid"; reason: "malformed" | "unknown-version" | "auth-tag-mismatch" };

function decodeBase64Strict(segment: string): Buffer | null {
  if (!BASE64_RE.test(segment)) return null;
  return Buffer.from(segment, "base64");
}

/**
 * Déchiffre une valeur stockée. Ne lève JAMAIS d'exception pour un
 * problème de donnée (enveloppe cassée, version inconnue, tag invalide,
 * mauvaise clé) — retourne un résultat typé, à charge de l'appelant de
 * décider (voir `resolveStoredToken`). Seule `getEncryptionKey` lève, pour
 * un problème de configuration globale (pas par ligne).
 */
export function decryptToken(envelope: string, key: Buffer): DecryptResult {
  if (isLegacyToken(envelope)) {
    return { status: "legacy", value: envelope };
  }

  const parts = envelope.split(":");
  if (parts.length !== 5 || parts[0] !== "enc") {
    return { status: "invalid", reason: "malformed" };
  }
  const [, version, ivB64, tagB64, ciphertextB64] = parts;
  if (version !== VERSION) {
    return { status: "invalid", reason: "unknown-version" };
  }

  const iv = decodeBase64Strict(ivB64);
  const authTag = decodeBase64Strict(tagB64);
  const ciphertext = decodeBase64Strict(ciphertextB64);
  if (!iv || iv.length !== IV_BYTE_LENGTH) return { status: "invalid", reason: "malformed" };
  if (!authTag || authTag.length !== AUTH_TAG_BYTE_LENGTH) return { status: "invalid", reason: "malformed" };
  if (!ciphertext || ciphertext.length === 0) return { status: "invalid", reason: "malformed" };

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAAD(Buffer.from(version, "utf8"));
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return { status: "encrypted", value: plaintext.toString("utf8") };
  } catch {
    return { status: "invalid", reason: "auth-tag-mismatch" };
  }
}

/**
 * Wrapper pratique pour les appelants (`discord-profile.ts`) : `null`/vide
 * → pas de jeton. Une enveloppe `invalid` (donnée corrompue, mauvaise clé)
 * est traitée exactement comme une absence de jeton utilisable — jamais
 * une exception qui remonterait et casserait le traitement des autres
 * utilisateurs d'une boucle.
 */
export function resolveStoredToken(
  value: string | null,
  key: Buffer
): { ok: true; value: string } | { ok: false } {
  if (!value) return { ok: false };
  const result = decryptToken(value, key);
  return result.status === "invalid" ? { ok: false } : { ok: true, value: result.value };
}
