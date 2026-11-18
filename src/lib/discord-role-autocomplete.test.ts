import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/lib/discord-rest", () => ({ listGuildRoles: mocks.list }));

import { buildRoleAutocompleteResponse, creationChoice, filterRoleChoices } from "./discord-role-autocomplete";

const APP = "100000000000000001";
const GUILD = "100000000000000002";

const role = (over: Record<string, unknown> = {}) => ({
  id: "role-1",
  name: "Zelda",
  position: 3,
  permissions: "0",
  managed: false,
  ...over,
});

const interaction = (subName: string, focusedValue = "") => ({
  type: 4,
  application_id: APP,
  guild_id: GUILD,
  data: { name: "role", options: [{ name: subName, options: [{ name: "jeu", focused: true, value: focusedValue }] }] },
});
const now = () => String(Math.floor(Date.now() / 1000));
const choicesOf = (response: { body?: unknown }) =>
  (response.body as { data: { choices: Array<{ name: string; value: string }> } }).data.choices;

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_ROLE_COMMAND_ENABLED", "true");
  mocks.list.mockResolvedValue({ ok: true, data: { roles: [role()] } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.list.mockReset();
});

describe("autocomplétion /role", () => {
  it("propose les rôles de jeu sans accent ni doublon, valeur = nom réel", async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      data: {
        roles: [
          role({ id: "r1", name: "Éco" }),
          role({ id: "r2", name: "Eco" }),
          role({ id: "r3", name: "Valheim" }),
        ],
      },
    });
    const choices = choicesOf(await buildRoleAutocompleteResponse(interaction("chercher", "eco"), now()));
    expect(choices.map((choice) => choice.value)).toEqual(["Éco"]);
  });

  it("exclut les rôles sensibles et les intégrations", () => {
    const choices = filterRoleChoices(
      [
        role({ id: "r1", name: "Administrateur", permissions: "8" }),
        role({ id: "r2", name: "Bot", managed: true }),
        role({ id: "r3", name: "@everyone", position: 0 }),
        role({ id: "r4", name: "Valheim" }),
      ],
      ""
    );
    expect(choices.map((choice) => choice.name)).toEqual(["Valheim"]);
  });

  it("classe d’abord les préfixes exacts", () => {
    const choices = filterRoleChoices(
      [role({ id: "r1", name: "Monde de Valheim" }), role({ id: "r2", name: "Valheim" })],
      "val"
    );
    expect(choices[0].name).toBe("Valheim");
  });

  it("ajoute le nom canonique pour `creer`, jamais s’il est sensible", async () => {
    const choices = choicesOf(await buildRoleAutocompleteResponse(interaction("creer", "  Nouveau   Jeu "), now()));
    expect(choices[0]).toEqual({ name: "Nouveau Jeu", value: "Nouveau Jeu" });
    expect(creationChoice("Administrateur")).toBeNull();
    expect(creationChoice("")).toBeNull();
  });

  it("renvoie une liste vide si Discord échoue, sans erreur bloquante", async () => {
    mocks.list.mockResolvedValue({ ok: false, kind: "rate_limited" });
    expect(choicesOf(await buildRoleAutocompleteResponse(interaction("chercher", ""), now()))).toEqual([]);
  });

  it("refuse une commande fermée, un MP, une autre application ou un horodatage périmé", async () => {
    vi.stubEnv("DISCORD_ROLE_COMMAND_ENABLED", "");
    expect((await buildRoleAutocompleteResponse(interaction("chercher", ""), now())).status).toBe(400);

    vi.stubEnv("DISCORD_ROLE_COMMAND_ENABLED", "true");
    expect((await buildRoleAutocompleteResponse({ ...interaction("chercher"), guild_id: undefined }, now())).status).toBe(400);
    expect((await buildRoleAutocompleteResponse({ ...interaction("chercher"), application_id: "100000000000000009" }, now())).status).toBe(
      400
    );
    expect((await buildRoleAutocompleteResponse(interaction("chercher", ""), String(Math.floor(Date.now() / 1000) - 400))).status).toBe(
      400
    );
  });
});
