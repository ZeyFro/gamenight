import { describe, expect, it } from "vitest";
import commands from "../../scripts/discord-commands.json";

type Option = { type: number; name: string; required?: boolean; options?: Option[]; min_value?: number; max_value?: number };

describe("définition installable de /projet", () => {
  const command = commands.find((candidate) => candidate.name === "projet") as { options: Option[] } | undefined;

  it("expose exactement les sous-commandes du handler, en serveur et pour tous les membres", () => {
    expect(command).toMatchObject({ name: "projet", type: 1, default_member_permissions: null, integration_types: [0], contexts: [0] });
    expect(command?.options.map((option) => option.name)).toEqual(["liste", "voir", "rejoindre", "quitter", "creer", "recrutement", "espace"]);
    expect(command?.options.every((option) => option.type === 1)).toBe(true);
  });

  it("aligne les options sur les règles d'équipe de main (2 à 8 places, noms d'options sans accent)", () => {
    const create = command?.options.find((option) => option.name === "creer");
    expect(create?.options?.map((option) => option.name)).toEqual(["nom", "jeu", "objectif", "plateforme", "places"]);
    expect(create?.options?.find((option) => option.name === "places")).toMatchObject({ type: 4, min_value: 2, max_value: 8 });
    for (const sub of command?.options ?? []) for (const option of sub.options ?? []) expect(option.name).toMatch(/^[a-z_]{1,32}$/);
  });

  it("laisse /equipe intacte : mêmes trois sous-commandes et option equipe_id", () => {
    const team = commands.find((candidate) => candidate.name === "equipe") as { options: Option[] };
    expect(team.options.map((option) => option.name)).toEqual(["liste", "moi", "rejoindre"]);
    expect(team.options[2].options?.[0]).toMatchObject({ name: "equipe_id", required: true });
  });
});
