import { z } from "zod";

export const GAMING_IDENTIFIER_FIELDS = [
  { key: "psnId", label: "PlayStation Network (PSN)" },
  { key: "xboxGamertag", label: "Gamertag Xbox" },
  { key: "switchFriendCode", label: "Code ami Nintendo Switch" },
  { key: "epicDisplayName", label: "Pseudo Epic Games" },
  { key: "battleTag", label: "BattleTag Battle.net" },
] as const;

// Pseudonymes déclarés, pas une validation des règles ou de l'existence d'un
// compte distant. Les espaces internes, la casse et les suffixes sont conservés.
const identifier = z.string().trim().max(100).refine(
  value => [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127),
  "Utilise un identifiant sur une seule ligne."
).transform(value => value || null);

export const gamingIdentifiersSchema = z.object({
  psnId: identifier,
  xboxGamertag: identifier,
  switchFriendCode: identifier,
  epicDisplayName: identifier,
  battleTag: identifier,
});

export type GamingIdentifiers = z.output<typeof gamingIdentifiersSchema>;
