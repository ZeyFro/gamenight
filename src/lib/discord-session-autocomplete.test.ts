import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  load: vi.fn(),
}));

vi.mock("@/lib/discord-session-commands", () => ({
  resolveSessionContext: mocks.context,
  loadUpcomingSessions: mocks.load,
}));

import {
  buildSessionAutocompleteResponse,
  filterSessionCandidates,
  remainingSeats,
  toSessionChoices,
} from "./discord-session-autocomplete";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const USER = "user-1";

const session = (over: Record<string, unknown> = {}) => ({
  id: "session-1",
  date: new Date("2026-12-05T20:00:00.000Z"),
  status: "SCHEDULED",
  statusLabel: "Planifiée",
  game: "Valheim",
  proposals: 0,
  creatorName: "Maxime",
  invitees: ["Alex"],
  capacity: 6,
  isCreator: false,
  isInvited: false,
  ...over,
});

const interaction = (subName: string, focusedValue = "") => ({
  type: 4,
  application_id: APP,
  guild_id: GUILD,
  member: { user: { id: DISCORD } },
  data: {
    name: "soiree",
    options: [{ name: subName, options: [{ name: "soiree", focused: true, value: focusedValue }] }],
  },
});
const now = () => String(Math.floor(Date.now() / 1000));

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  mocks.context.mockResolvedValue({ status: "OK", userId: USER, communityId: "community-1", communityName: "The Tower" });
  mocks.load.mockResolvedValue([session()]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("autocomplétion /soiree", () => {
  it("propose les soirées avec places réellement libres", async () => {
    const response = await buildSessionAutocompleteResponse(interaction("voir", ""), now());
    expect(response.status).toBe(200);
    const body = response.body as { data: { choices: Array<{ name: string; value: string }> } };
    expect(body.data.choices[0].value).toBe("session-1");
    expect(body.data.choices[0].name).toContain("Valheim");
    expect(body.data.choices[0].name).toContain("4 place(s) libre(s)"); // 6 − (1 invité + organisateur)
  });

  it("affiche le jeu proposé quand aucun jeu n'est décidé, et le retrouve à la recherche", () => {
    const pending = [session({ game: null, proposedGames: ["Deadlock"] })] as never;
    expect(toSessionChoices(pending, "voir")[0].name).toContain("Deadlock (proposé)");
    expect(toSessionChoices(pending, "voir")[0].name).not.toContain("jeu à définir");
    expect(filterSessionCandidates(pending, "deadlock")).toHaveLength(1);
    expect(toSessionChoices([session({ game: null, proposedGames: [] })] as never, "voir")[0].name).toContain("jeu à définir");
  });

  it("calcule les places et gère la capacité illimitée", () => {
    expect(remainingSeats(session({ invitees: [], capacity: 5 }) as never)).toBe(4);
    expect(remainingSeats(session({ capacity: null }) as never)).toBeNull();
    expect(remainingSeats(session({ invitees: ["a", "b", "c", "d", "e"], capacity: 6 }) as never)).toBe(0);
  });

  it("n’offre à rejoindre que ce qui est rejoignable, à quitter que ses inscriptions", () => {
    const rows = [session(), session({ id: "session-2", isInvited: true }), session({ id: "session-3", isCreator: true })];
    expect(toSessionChoices(rows as never, "voir")).toHaveLength(3);
    expect(toSessionChoices(rows as never, "rejoindre").map((c) => c.value)).toEqual(["session-1"]);
    expect(toSessionChoices(rows as never, "quitter").map((c) => c.value)).toEqual(["session-2"]);
  });

  it("filtre sans accent et par organisateur", () => {
    expect(filterSessionCandidates([session(), session({ game: "Éco" })] as never, "eco")).toHaveLength(1);
    expect(filterSessionCandidates([session()] as never, "maxime")).toHaveLength(1);
    expect(filterSessionCandidates([session()] as never, "zzz")).toHaveLength(0);
  });

  it("renvoie une liste vide sans révéler quoi que ce soit hors communauté", async () => {
    mocks.context.mockResolvedValue({ status: "NOT_MEMBER" });
    const response = await buildSessionAutocompleteResponse(interaction("voir", ""), now());
    expect((response.body as { data: { choices: unknown[] } }).data.choices).toEqual([]);
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it("refuse une commande inconnue, un MP ou un horodatage périmé", async () => {
    expect((await buildSessionAutocompleteResponse(interaction("creer", ""), now())).status).toBe(400);
    expect((await buildSessionAutocompleteResponse({ ...interaction("voir", ""), guild_id: undefined }, now())).status).toBe(400);
    expect(
      (await buildSessionAutocompleteResponse(interaction("voir", ""), String(Math.floor(Date.now() / 1000) - 400))).status
    ).toBe(400);
  });
});
