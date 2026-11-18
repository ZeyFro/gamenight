import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/discord-tournament-autocomplete", () => ({
  buildAutocompleteResponse: vi.fn(async () => ({ status: 200, body: { type: 8, data: { choices: ["t"] } } })),
}));
vi.mock("@/lib/discord-session-autocomplete", () => ({
  buildSessionAutocompleteResponse: vi.fn(async () => ({ status: 200, body: { type: 8, data: { choices: ["s"] } } })),
}));

import { handleSignedAutocomplete } from "./discord-autocomplete";

describe("routage des interactions d’autocomplétion (type 4)", () => {
  it("route /tournoi et /soiree vers leurs adaptateurs dédiés", async () => {
    const tournament = await handleSignedAutocomplete({ data: { name: "tournoi" } }, "1");
    const session = await handleSignedAutocomplete({ data: { name: "soiree" } }, "1");
    expect((tournament.body as { data: { choices: string[] } }).data.choices).toEqual(["t"]);
    expect((session.body as { data: { choices: string[] } }).data.choices).toEqual(["s"]);
  });

  it("refuse toute autre commande, y compris un corps non conforme", async () => {
    expect((await handleSignedAutocomplete({ data: { name: "equipe" } }, "1")).status).toBe(400);
    expect((await handleSignedAutocomplete({}, "1")).status).toBe(400);
    expect((await handleSignedAutocomplete(null, "1")).status).toBe(400);
  });
});
