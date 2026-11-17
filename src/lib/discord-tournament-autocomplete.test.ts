import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  tournamentFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findFirst: mocks.community },
    user: { findUnique: mocks.user },
    membership: { findUnique: mocks.membership },
    tournament: { findMany: mocks.tournamentFindMany },
  },
}));

import {
  buildAutocompleteResponse,
  filterTournamentCandidates,
  toTournamentChoices,
} from "./discord-tournament-autocomplete";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const USER = "user-1";

const row = (over: Record<string, unknown> = {}) => ({
  id: "tournoi-1",
  name: "Coupe d’hiver",
  status: "REGISTRATION",
  maxPlayers: 8,
  game: { name: "Valheim" },
  _count: { participants: 3 },
  ...over,
});

const interaction = (subName: string, focusedValue = "") => ({
  type: 4,
  application_id: APP,
  guild_id: GUILD,
  member: { user: { id: DISCORD } },
  data: {
    name: "tournoi",
    options: [
      {
        name: subName,
        type: 1,
        options: [{ name: "tournoi", type: 3, focused: true, value: focusedValue }],
      },
    ],
  },
});
const now = () => String(Math.floor(Date.now() / 1000));

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower" });
  mocks.user.mockResolvedValue({ id: USER });
  mocks.membership.mockResolvedValue({ status: "ACTIVE" });
  mocks.tournamentFindMany.mockResolvedValue([row()]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("autocomplétion /tournoi", () => {
  it("propose les tournois ouverts à l’inscription, avec jeu et places", async () => {
    const response = await buildAutocompleteResponse(interaction("inscription", ""), now());
    expect(response.status).toBe(200);
    const body = response.body as { type: number; data: { choices: Array<{ name: string; value: string }> } };
    expect(body.type).toBe(8);
    expect(body.data.choices[0].value).toBe("tournoi-1");
    expect(body.data.choices[0].name).toContain("Valheim");
    expect(body.data.choices[0].name).toContain("3/8");
  });

  it("exclut les tournois complets et filtre sur la saisie", () => {
    const rows = [row(), row({ id: "tournoi-2", name: "Open", _count: { participants: 8 } })];
    expect(toTournamentChoices(rows, "inscription")).toHaveLength(1);
    expect(toTournamentChoices(rows, "desinscription")).toHaveLength(2);
    expect(filterTournamentCandidates(rows, "hiver")).toHaveLength(1);
    expect(filterTournamentCandidates(rows, "HIVER")).toHaveLength(1);
    expect(filterTournamentCandidates(rows, "zzz")).toHaveLength(0);
  });

  it("ne propose à la désinscription que les tournois du joueur", async () => {
    await buildAutocompleteResponse(interaction("desinscription", "coupe"), now());
    expect(mocks.tournamentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          communityId: "community-1",
          participants: { some: { userId: USER } },
        }),
      })
    );
  });

  it("propose l’inscription uniquement là où le joueur n’est pas déjà inscrit", async () => {
    await buildAutocompleteResponse(interaction("inscription", ""), now());
    expect(mocks.tournamentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ participants: { none: { userId: USER } } }),
      })
    );
  });

  it("renvoie une liste vide à un non-membre, sans fuite", async () => {
    mocks.membership.mockResolvedValue({ status: "PENDING" });
    const response = await buildAutocompleteResponse(interaction("inscription", ""), now());
    expect(response.status).toBe(200);
    expect((response.body as { data: { choices: unknown[] } }).data.choices).toEqual([]);
    expect(mocks.tournamentFindMany).not.toHaveBeenCalled();
  });

  it("refuse un horodatage périmé, une autre application, un MP ou une autre commande", async () => {
    expect((await buildAutocompleteResponse(interaction("inscription", ""), String(Math.floor(Date.now() / 1000) - 400))).status).toBe(400);
    expect((await buildAutocompleteResponse({ ...interaction("inscription", ""), application_id: "100000000000000099" }, now())).status).toBe(400);
    expect((await buildAutocompleteResponse({ ...interaction("inscription", ""), guild_id: undefined }, now())).status).toBe(400);
    expect((await buildAutocompleteResponse(interaction("liste", ""), now())).status).toBe(400);
  });
});
