import { randomBytes } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createTowerChallengeProofCode(): string {
  return "TWR-" + Array.from(randomBytes(8), value => CODE_ALPHABET[value & 31]).join("");
}

export function proofTextIncludesTowerCode(proofText: string, code: string): boolean {
  return proofText.toUpperCase().includes(code);
}
