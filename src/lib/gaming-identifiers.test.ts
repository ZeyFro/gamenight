import { describe, expect, it } from "vitest";
import { gamingIdentifiersSchema } from "./gaming-identifiers";

const valid = {
  psnId: "Joueur_PSN",
  xboxGamertag: "Joueur Xbox#1234",
  switchFriendCode: "SW-1234-5678-9012",
  epicDisplayName: "Joueur Epic",
  battleTag: "Joueur#12345",
};

describe("identifiants de jeu déclaratifs", () => {
  it("conserve les espaces internes, la casse et les suffixes de plateforme", () => {
    expect(gamingIdentifiersSchema.parse({ ...valid, psnId: "  Joueur_PSN  " })).toEqual(valid);
  });

  it("un champ vide efface uniquement sa valeur, sans champ de compte Steam", () => {
    expect(gamingIdentifiersSchema.parse({ ...valid, psnId: "  ", steamId64: "forged" })).toEqual({ ...valid, psnId: null });
  });

  it.each(Object.keys(valid))("refuse les valeurs trop longues et multilignes (%s)", key => {
    expect(gamingIdentifiersSchema.safeParse({ ...valid, [key]: "x".repeat(101) }).success).toBe(false);
    expect(gamingIdentifiersSchema.safeParse({ ...valid, [key]: "nom\nligne" }).success).toBe(false);
  });

  it("refuse un fichier ou une valeur absente au lieu d'effacer silencieusement", () => {
    expect(gamingIdentifiersSchema.safeParse({ ...valid, psnId: new Blob(["x"]) }).success).toBe(false);
    expect(gamingIdentifiersSchema.safeParse({ ...valid, psnId: undefined }).success).toBe(false);
  });
});
