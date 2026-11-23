import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/discord-tournament-autocomplete", () => ({
  buildAutocompleteResponse: vi.fn(async () => ({ status: 200, body: { type: 8, data: { choices: ["t"] } } })),
}));
vi.mock("@/lib/discord-session-autocomplete", () => ({
  buildSessionAutocompleteResponse: vi.fn(async () => ({ status: 200, body: { type: 8, data: { choices: ["s"] } } })),
}));
vi.mock("@/lib/discord-role-autocomplete", () => ({ buildRoleAutocompleteResponse: vi.fn() }));
const { warn, error } = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn, error, info: vi.fn() } }));

import { handleSignedAutocomplete, AUTOCOMPLETE_BUDGET_MS } from "./discord-autocomplete";
import { buildAutocompleteResponse } from "@/lib/discord-tournament-autocomplete";
import { buildRoleAutocompleteResponse } from "@/lib/discord-role-autocomplete";

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

/** Audit du 23/11/2026 : l'autocomplétion ne peut pas être différée ; base endormie, elle dépassait les 3 s de Discord. */
describe("budget de réponse de l'autocomplétion (base endormie)", () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });
  const never = () => new Promise<never>(() => undefined);

  it("le budget laisse de la marge sous les 3 s de Discord", () => {
    expect(AUTOCOMPLETE_BUDGET_MS).toBeLessThan(3000);
    expect(AUTOCOMPLETE_BUDGET_MS).toBeGreaterThanOrEqual(1500);
  });

  it("adaptateur bloqué (base qui se réveille) : liste vide au bout du budget, avec un avertissement", async () => {
    vi.useFakeTimers();
    vi.mocked(buildAutocompleteResponse).mockImplementationOnce(never);
    const pending = handleSignedAutocomplete({ data: { name: "tournoi" } }, "1");
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_BUDGET_MS);
    expect(await pending).toEqual({ status: 200, body: { type: 8, data: { choices: [] } } });
    expect(warn).toHaveBeenCalledWith("discord-autocomplete", expect.stringContaining("trop lente"), expect.objectContaining({ command: "tournoi" }));
  });

  it("réponse rapide : transmise telle quelle, sans avertissement ni minuterie qui traîne", async () => {
    vi.useFakeTimers();
    const result = await handleSignedAutocomplete({ data: { name: "soiree" } }, "1");
    expect((result.body as { data: { choices: string[] } }).data.choices).toEqual(["s"]);
    expect(vi.getTimerCount()).toBe(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("échec rapide : propagé comme avant (jamais avalé)", async () => {
    vi.mocked(buildRoleAutocompleteResponse).mockRejectedValueOnce(new Error("base indisponible"));
    await expect(handleSignedAutocomplete({ data: { name: "role" } }, "1")).rejects.toThrow("base indisponible");
  });

  it("échec tardif, après la réponse vide : journalisé, jamais une promesse rejetée sans gestionnaire", async () => {
    vi.useFakeTimers();
    let fail!: (e: Error) => void;
    vi.mocked(buildRoleAutocompleteResponse).mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const pending = handleSignedAutocomplete({ data: { name: "role" } }, "1");
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_BUDGET_MS);
    expect((await pending).status).toBe(200);
    fail(new Error("trop tard"));
    await vi.advanceTimersByTimeAsync(0);
    expect(error).toHaveBeenCalledWith("discord-autocomplete", expect.any(Error), expect.objectContaining({ late: true }));
  });

  it("réponse arrivée après le budget : ignorée (la liste vide est déjà partie)", async () => {
    vi.useFakeTimers();
    let finish!: (v: { status: 200; body: unknown }) => void;
    vi.mocked(buildAutocompleteResponse).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve as typeof finish; }));
    const pending = handleSignedAutocomplete({ data: { name: "tournoi" } }, "1");
    await vi.advanceTimersByTimeAsync(AUTOCOMPLETE_BUDGET_MS);
    const first = await pending;
    finish({ status: 200, body: { type: 8, data: { choices: ["tard"] } } });
    await vi.advanceTimersByTimeAsync(0);
    expect((first.body as { data: { choices: unknown[] } }).data.choices).toEqual([]);
  });
});
