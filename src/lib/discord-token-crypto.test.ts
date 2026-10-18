import { describe, it, expect, afterEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  getEncryptionKey,
  encryptToken,
  decryptToken,
  isLegacyToken,
  resolveStoredToken,
  DiscordTokenEncryptionKeyError,
} from "./discord-token-crypto";

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);
const ENV_VAR = "DISCORD_TOKEN_ENCRYPTION_KEY";

describe("getEncryptionKey", () => {
  const original = process.env[ENV_VAR];

  afterEach(() => {
    if (original === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = original;
  });

  it("lève une erreur contrôlée si la variable est absente", () => {
    delete process.env[ENV_VAR];
    expect(() => getEncryptionKey()).toThrow(DiscordTokenEncryptionKeyError);
  });

  it("lève une erreur contrôlée si la valeur n'est pas du Base64 valide", () => {
    process.env[ENV_VAR] = "!!! pas du base64 !!!";
    expect(() => getEncryptionKey()).toThrow(DiscordTokenEncryptionKeyError);
  });

  it("lève une erreur contrôlée si la longueur décodée n'est pas 32 octets", () => {
    process.env[ENV_VAR] = Buffer.from("trop court").toString("base64");
    expect(() => getEncryptionKey()).toThrow(DiscordTokenEncryptionKeyError);
  });

  it("retourne un Buffer de 32 octets pour une clé valide", () => {
    process.env[ENV_VAR] = KEY.toString("base64");
    const key = getEncryptionKey();
    expect(key.length).toBe(32);
    expect(key.equals(KEY)).toBe(true);
  });

  it("le message d'erreur ne contient jamais la valeur de la variable", () => {
    process.env[ENV_VAR] = "!!! pas du base64 !!!";
    try {
      getEncryptionKey();
      expect.fail("devait lever");
    } catch (error) {
      expect((error as Error).message).not.toContain("pas du base64");
    }
  });
});

describe("isLegacyToken", () => {
  it("reconnaît une valeur sans préfixe enc: comme legacy", () => {
    expect(isLegacyToken("un-vrai-jeton-discord-abcd1234")).toBe(true);
  });

  it("ne reconnaît pas une enveloppe enc: comme legacy", () => {
    expect(isLegacyToken("enc:v1:aaaa:bbbb:cccc")).toBe(false);
  });
});

describe("encryptToken / decryptToken — round-trip", () => {
  it("chiffre puis déchiffre un access token", () => {
    const plaintext = "discord-access-token-XyZ.abc123";
    const envelope = encryptToken(plaintext, KEY);
    const result = decryptToken(envelope, KEY);
    expect(result).toEqual({ status: "encrypted", value: plaintext });
  });

  it("chiffre puis déchiffre un refresh token", () => {
    const plaintext = "discord-refresh-token-QwErTy.987";
    const envelope = encryptToken(plaintext, KEY);
    const result = decryptToken(envelope, KEY);
    expect(result).toEqual({ status: "encrypted", value: plaintext });
  });

  it("produit deux enveloppes différentes pour deux chiffrements du même texte (IV aléatoire)", () => {
    const plaintext = "meme-jeton-chiffre-deux-fois";
    const envelope1 = encryptToken(plaintext, KEY);
    const envelope2 = encryptToken(plaintext, KEY);
    expect(envelope1).not.toBe(envelope2);
    // Les deux restent déchiffrables vers le même texte.
    expect(decryptToken(envelope1, KEY)).toEqual({ status: "encrypted", value: plaintext });
    expect(decryptToken(envelope2, KEY)).toEqual({ status: "encrypted", value: plaintext });
  });

  it("respecte le format enc:v1:<iv>:<tag>:<ciphertext>", () => {
    const envelope = encryptToken("x", KEY);
    const parts = envelope.split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("enc");
    expect(parts[1]).toBe("v1");
  });
});

describe("decryptToken — rejets", () => {
  it("rejette un ciphertext modifié", () => {
    const envelope = encryptToken("mon-jeton", KEY);
    const [prefix, version, iv, tag, ciphertext] = envelope.split(":");
    const tamperedCiphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
    const tampered = [prefix, version, iv, tag, tamperedCiphertext].join(":");
    expect(decryptToken(tampered, KEY)).toEqual({ status: "invalid", reason: "auth-tag-mismatch" });
  });

  it("rejette un tag modifié", () => {
    const envelope = encryptToken("mon-jeton", KEY);
    const [prefix, version, iv, tag, ciphertext] = envelope.split(":");
    const tamperedTag = Buffer.alloc(16, tag.charCodeAt(0) === 65 ? 66 : 65).toString("base64");
    const tampered = [prefix, version, iv, tamperedTag, ciphertext].join(":");
    expect(decryptToken(tampered, KEY).status).toBe("invalid");
  });

  it("rejette un IV modifié", () => {
    const envelope = encryptToken("mon-jeton", KEY);
    const [prefix, version, , tag, ciphertext] = envelope.split(":");
    const differentIv = randomBytes(12).toString("base64");
    const tampered = [prefix, version, differentIv, tag, ciphertext].join(":");
    expect(decryptToken(tampered, KEY)).toEqual({ status: "invalid", reason: "auth-tag-mismatch" });
  });

  it("rejette avec la mauvaise clé", () => {
    const envelope = encryptToken("mon-jeton", KEY);
    expect(decryptToken(envelope, OTHER_KEY)).toEqual({ status: "invalid", reason: "auth-tag-mismatch" });
  });

  it("rejette un nombre de segments incorrect (jamais legacy)", () => {
    expect(decryptToken("enc:v1:seulement-trois", KEY).status).toBe("invalid");
  });

  it("rejette une version inconnue (jamais legacy)", () => {
    const envelope = encryptToken("mon-jeton", KEY);
    const [, , iv, tag, ciphertext] = envelope.split(":");
    const wrongVersion = ["enc", "v2", iv, tag, ciphertext].join(":");
    expect(decryptToken(wrongVersion, KEY)).toEqual({ status: "invalid", reason: "unknown-version" });
  });

  it("rejette un segment non-Base64 (jamais legacy)", () => {
    expect(decryptToken("enc:v1:!!!not-base64!!!:bbbb:cccc", KEY).status).toBe("invalid");
  });

  it("rejette un IV de mauvaise longueur", () => {
    const shortIv = Buffer.alloc(4).toString("base64");
    const envelope = encryptToken("mon-jeton", KEY);
    const [prefix, version, , tag, ciphertext] = envelope.split(":");
    expect(decryptToken([prefix, version, shortIv, tag, ciphertext].join(":"), KEY)).toEqual({
      status: "invalid",
      reason: "malformed",
    });
  });

  it("rejette un tag de mauvaise longueur", () => {
    const shortTag = Buffer.alloc(4).toString("base64");
    const envelope = encryptToken("mon-jeton", KEY);
    const [prefix, version, iv, , ciphertext] = envelope.split(":");
    expect(decryptToken([prefix, version, iv, shortTag, ciphertext].join(":"), KEY)).toEqual({
      status: "invalid",
      reason: "malformed",
    });
  });

  it("rejette un ciphertext vide", () => {
    const envelope = encryptToken("mon-jeton", KEY);
    const [prefix, version, iv, tag] = envelope.split(":");
    expect(decryptToken([prefix, version, iv, tag, ""].join(":"), KEY)).toEqual({
      status: "invalid",
      reason: "malformed",
    });
  });

  it("aucun message/résultat d'erreur ne contient le plaintext, le ciphertext, la clé ou l'IV", () => {
    const plaintext = "SECRET-PLAINTEXT-abc123";
    const envelope = encryptToken(plaintext, KEY);
    const result = decryptToken(envelope, OTHER_KEY);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(plaintext);
    expect(serialized).not.toContain(KEY.toString("base64"));
    expect(serialized).not.toContain(envelope);
  });
});

describe("decryptToken — legacy", () => {
  it("reconnaît une ancienne valeur en clair (sans préfixe enc:)", () => {
    const legacyToken = "un-vrai-jeton-discord-jamais-chiffre";
    expect(decryptToken(legacyToken, KEY)).toEqual({ status: "legacy", value: legacyToken });
  });
});

describe("resolveStoredToken", () => {
  it("retourne ok:false pour une valeur null", () => {
    expect(resolveStoredToken(null, KEY)).toEqual({ ok: false });
  });

  it("retourne ok:true pour une valeur chiffrée valide", () => {
    const envelope = encryptToken("mon-jeton", KEY);
    expect(resolveStoredToken(envelope, KEY)).toEqual({ ok: true, value: "mon-jeton" });
  });

  it("retourne ok:true pour une ancienne valeur en clair", () => {
    expect(resolveStoredToken("vieux-jeton-en-clair", KEY)).toEqual({
      ok: true,
      value: "vieux-jeton-en-clair",
    });
  });

  it("retourne ok:false pour une enveloppe invalide (jamais d'exception)", () => {
    expect(resolveStoredToken("enc:v1:cassee", KEY)).toEqual({ ok: false });
  });

  it("retourne ok:false pour la mauvaise clé (donnée illisible, pas une exception)", () => {
    const envelope = encryptToken("mon-jeton", KEY);
    expect(resolveStoredToken(envelope, OTHER_KEY)).toEqual({ ok: false });
  });
});
