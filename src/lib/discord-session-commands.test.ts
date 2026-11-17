import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  community: vi.fn(),
  user: vi.fn(),
  membership: vi.fn(),
  sessionFindUnique: vi.fn(),
  sessionFindMany: vi.fn(),
  inviteFindUnique: vi.fn(),
  transaction: vi.fn(),
  accessibleWhere: vi.fn(),
  accessRole: vi.fn(),
  invite: vi.fn(),
  revoke: vi.fn(),
  createInTx: vi.fn(),
  schedule: vi.fn(),
  resolveGame: vi.fn(),
  edit: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    community: { findFirst: mocks.community },
    user: { findUnique: mocks.user },
    membership: { findUnique: mocks.membership },
    session: { findUnique: mocks.sessionFindUnique, findMany: mocks.sessionFindMany },
    sessionInvite: { findUnique: mocks.inviteFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock("@/lib/session-access", () => ({
  accessibleSessionWhereFor: mocks.accessibleWhere,
  getSessionAccessRole: mocks.accessRole,
  inviteToSession: mocks.invite,
  revokeSessionInvite: mocks.revoke,
}));
vi.mock("@/lib/session-creation", () => ({ createVotingSessionInTransaction: mocks.createInTx }));
vi.mock("@/lib/session-schedule", () => ({ resolveSessionSchedule: mocks.schedule }));
vi.mock("@/lib/discord-team-commands", () => ({ resolveGameId: mocks.resolveGame }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import {
  createSessionFromDiscord,
  handleSignedSessionInteraction,
  joinSession,
  leaveSession,
  loadSessionDetail,
  loadUpcomingSessions,
  renderSessionDetail,
  renderSessionList,
  sessionCommandEnabled,
  sessionWriteEnabled,
  type SessionView,
} from "./discord-session-commands";

const APP = "100000000000000001";
const GUILD = "100000000000000002";
const DISCORD = "100000000000000004";
const USER = "user-1";
const SESSION = "session-1";

const view = (over: Partial<SessionView> = {}): SessionView => ({
  id: SESSION,
  date: new Date("2026-12-05T20:00:00.000Z"),
  status: "VOTING",
  statusLabel: "Vote ouvert",
  game: "Valheim",
  proposals: 1,
  creatorName: "Maxime",
  invitees: ["Sarah"],
  capacity: 6,
  isCreator: false,
  isInvited: true,
  ...over,
});

const row = (over: Record<string, unknown> = {}) => ({
  id: SESSION,
  date: new Date("2026-12-05T20:00:00.000Z"),
  status: "VOTING",
  attendanceCapacity: 6,
  createdById: "user-2",
  createdBy: { discordName: "Maxime" },
  decidedGame: { name: "Valheim" },
  _count: { proposals: 1, invites: 1 },
  invites: [{ userId: USER, user: { discordName: "Sarah" } }],
  ...over,
});

const setupContext = () => {
  mocks.community.mockResolvedValue({ id: "community-1", name: "The Tower" });
  mocks.user.mockResolvedValue({ id: USER });
  mocks.membership.mockResolvedValue({ status: "ACTIVE" });
};

beforeEach(() => {
  vi.stubEnv("DISCORD_CLIENT_ID", APP);
  vi.stubEnv("DISCORD_BOT_TOKEN", "bot-token");
  vi.stubEnv("DISCORD_SESSION_COMMAND_ENABLED", "true");
  vi.stubEnv("DISCORD_SESSION_WRITE_ENABLED", "");
  setupContext();
  mocks.edit.mockResolvedValue({ ok: true });
  mocks.accessibleWhere.mockResolvedValue({ OR: [{ createdById: USER }] });
  mocks.sessionFindMany.mockResolvedValue([row()]);
  mocks.sessionFindUnique.mockResolvedValue(row());
  mocks.accessRole.mockResolvedValue("guest");
  mocks.invite.mockResolvedValue({ id: "invite-1" });
  mocks.revoke.mockResolvedValue(true);
  mocks.schedule.mockReturnValue({
    ok: true,
    date: new Date("2026-12-05T20:00:00.000Z"),
    votingDeadline: new Date("2026-12-05T18:00:00.000Z"),
    deadlineAdjusted: false,
  });
  mocks.resolveGame.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Valheim" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

const interaction = (subName: string, options: Array<{ name: string; value: string | number | boolean }> = []) => ({
  type: 2,
  id: "100000000000000070",
  application_id: APP,
  token: "token-soiree",
  guild_id: GUILD,
  member: { user: { id: DISCORD, username: "maxime", bot: false } },
  data: {
    name: "soiree",
    options: [
      {
        name: subName,
        type: 1,
        options: options.map((option) => ({
          name: option.name,
          type: typeof option.value === "number" ? 4 : 3,
          value: option.value,
        })),
      },
    ],
  },
});
const now = () => String(Math.floor(Date.now() / 1000));

async function deferredContent(output: ReturnType<typeof handleSignedSessionInteraction>): Promise<string> {
  await output.runSession?.();
  const call = mocks.edit.mock.calls.at(-1) as unknown as [{ content: string }];
  return call[0].content;
}

describe("/soiree — interrupteurs et sécurité", () => {
  it("reste fermée par défaut, sans lire la base", () => {
    vi.stubEnv("DISCORD_SESSION_COMMAND_ENABLED", "");
    expect(sessionCommandEnabled()).toBe(false);
    const output = handleSignedSessionInteraction(interaction("liste"), now());
    expect(JSON.stringify(output.body)).toContain("pas encore ouverte");
    expect(output.runSession).toBeUndefined();
    expect(mocks.community).not.toHaveBeenCalled();
  });

  it("sépare lecture et écriture", () => {
    expect(sessionWriteEnabled()).toBe(false);
    const output = handleSignedSessionInteraction(interaction("rejoindre", [{ name: "soiree", value: SESSION }]), now());
    expect(JSON.stringify(output.body)).toContain("n’est pas encore ouvert");
    expect(output.runSession).toBeUndefined();
    expect(mocks.invite).not.toHaveBeenCalled();
  });

  it("refuse un MP, un horodatage périmé et une autre application", () => {
    const base = interaction("liste");
    expect(JSON.stringify(handleSignedSessionInteraction({ ...base, guild_id: undefined }, now()).body)).toContain("dans le serveur");
    expect(handleSignedSessionInteraction(base, String(Math.floor(Date.now() / 1000) - 400)).status).toBe(400);
    expect(handleSignedSessionInteraction({ ...base, application_id: "100000000000000099" }, now()).status).toBe(400);
  });
});

describe("/soiree — lecture", () => {
  it("liste les prochaines soirées accessibles avec leurs places", async () => {
    const content = await deferredContent(handleSignedSessionInteraction(interaction("liste"), now()));
    expect(content).toContain("Prochaines soirées");
    expect(content).toContain("Valheim");
    expect(content).toContain("2/6");
    expect(content).toContain(SESSION);
    expect(mocks.sessionFindMany).toHaveBeenCalled();
  });

  it("n’expose pas une soirée dont l’accès n’est pas établi côté serveur", async () => {
    mocks.accessRole.mockResolvedValue(null);
    const content = await deferredContent(
      handleSignedSessionInteraction(interaction("voir", [{ name: "soiree", value: SESSION }]), now())
    );
    expect(content).toContain("introuvable ou privée");
    expect(mocks.sessionFindUnique).not.toHaveBeenCalled();
  });

  it("détaille une soirée accessible", async () => {
    const content = await deferredContent(
      handleSignedSessionInteraction(interaction("voir", [{ name: "soiree", value: SESSION }]), now())
    );
    expect(content).toContain("Organisateur : Maxime");
    expect(content).toContain("Participants : Maxime, Sarah");
    expect(content).toContain("Tu es inscrit");
  });

  it("réutilise exactement la règle d’accès du site", async () => {
    const detail = await loadSessionDetail({ userId: USER, sessionId: SESSION });
    expect(mocks.accessRole).toHaveBeenCalledWith(USER, SESSION);
    expect(detail?.isInvited).toBe(true);
    await loadUpcomingSessions({ userId: USER, communityId: "community-1" });
    expect(mocks.accessibleWhere).toHaveBeenCalledWith(USER);
  });

  it("ne promet rien quand aucune soirée n’est visible", () => {
    expect(renderSessionList([], "The Tower")).toContain("Aucune soirée accessible");
  });

  it("rend les places et l’état du vote sans donnée privée", () => {
    const text = renderSessionDetail(view({ capacity: 8 }));
    expect(text).toContain("2/8 places");
    expect(text).not.toContain(DISCORD);
  });
});

describe("/soiree — inscription et désinscription", () => {
  it("s’inscrit de façon idempotente, au nom du créateur", async () => {
    mocks.inviteFindUnique.mockResolvedValue(null);
    const first = await joinSession({ userId: USER, sessionId: SESSION });
    expect(first).toBe("joined");
    expect(mocks.invite).toHaveBeenCalledWith(SESSION, "user-2", USER);

    mocks.inviteFindUnique.mockResolvedValue({ status: "ACTIVE" });
    expect(await joinSession({ userId: USER, sessionId: SESSION })).toBe("already");
    expect(mocks.invite).toHaveBeenCalledTimes(1);
  });

  it("respecte la capacité existante et le créateur", async () => {
    mocks.inviteFindUnique.mockResolvedValue(null);
    mocks.sessionFindUnique.mockResolvedValue({
      id: SESSION,
      createdById: "user-2",
      status: "VOTING",
      attendanceCapacity: 2,
      communityId: "community-1",
      _count: { invites: 1 },
    });
    expect(await joinSession({ userId: USER, sessionId: SESSION })).toBe("full");
    expect(mocks.invite).not.toHaveBeenCalled();

    mocks.sessionFindUnique.mockResolvedValue({
      id: SESSION,
      createdById: USER,
      status: "VOTING",
      attendanceCapacity: null,
      communityId: "community-1",
      _count: { invites: 0 },
    });
    expect(await joinSession({ userId: USER, sessionId: SESSION })).toBe("creator");
  });

  it("quitte via la révocation existante, sans toucher aux contributions", async () => {
    expect(await leaveSession({ userId: USER, sessionId: SESSION })).toBe("left");
    expect(mocks.revoke).toHaveBeenCalledWith(SESSION, USER, USER);

    mocks.revoke.mockResolvedValue(false);
    expect(await leaveSession({ userId: USER, sessionId: SESSION })).toBe("not_invited");

    mocks.sessionFindUnique.mockResolvedValue({ createdById: USER });
    expect(await leaveSession({ userId: USER, sessionId: SESSION })).toBe("creator");
  });

  it("répond en clair à l’inscription depuis Discord", async () => {
    vi.stubEnv("DISCORD_SESSION_WRITE_ENABLED", "true");
    mocks.inviteFindUnique.mockResolvedValue(null);
    const content = await deferredContent(
      handleSignedSessionInteraction(interaction("rejoindre", [{ name: "soiree", value: SESSION }]), now())
    );
    expect(content).toContain("Tu es inscrit");
    expect(mocks.invite).toHaveBeenCalled();
  });
});

describe("/soiree — création par le service existant", () => {
  const tx = { proposal: { create: vi.fn() }, session: { update: vi.fn() } };

  beforeEach(() => {
    vi.stubEnv("DISCORD_SESSION_WRITE_ENABLED", "true");
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
    mocks.createInTx.mockResolvedValue({ id: SESSION, date: new Date("2026-12-05T20:00:00.000Z") });
    mocks.resolveGame.mockResolvedValue({ kind: "FOUND", id: "game-1", name: "Valheim" });
  });

  it("crée une Session VOTING via createVotingSessionInTransaction, sans annonce Discord", async () => {
    const result = await createSessionFromDiscord({
      userId: USER,
      communityId: "community-1",
      gameQuery: "valheim",
      dateStr: "2026-12-05",
      timeStr: "21:00",
      places: 6,
    });
    expect(result.status).toBe("CREATED");
    expect(mocks.createInTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        createdById: USER,
        communityId: "community-1",
        announceViaBot: false,
        notifiedUserIds: [],
        reminderTimings: [1440, 120],
        customReminderMessage: null,
      })
    );
    // Le jeu demandé devient une proposition ; aucun jeu décidé n'est forcé.
    expect(tx.proposal.create).toHaveBeenCalledWith({
      data: { sessionId: SESSION, gameId: "game-1", proposedById: USER },
    });
    expect(tx.session.update).toHaveBeenCalledWith({ where: { id: SESSION }, data: { attendanceCapacity: 6 } });
  });

  it("refuse une soirée trop proche selon les règles existantes", async () => {
    mocks.schedule.mockReturnValue({ ok: false, error: "session_trop_proche" });
    const result = await createSessionFromDiscord({
      userId: USER,
      communityId: "community-1",
      gameQuery: "valheim",
      dateStr: "2026-12-05",
      timeStr: "21:00",
      places: null,
    });
    expect(result.status).toBe("TOO_CLOSE");
    expect(mocks.createInTx).not.toHaveBeenCalled();
  });

  it("valide les places et le jeu avant toute écriture", async () => {
    expect(
      (
        await createSessionFromDiscord({
          userId: USER,
          communityId: "community-1",
          gameQuery: "valheim",
          dateStr: "2026-12-05",
          timeStr: "21:00",
          places: 1,
        })
      ).status
    ).toBe("INVALID_PLACES");

    mocks.resolveGame.mockResolvedValue({ kind: "AMBIGUOUS", names: ["Valheim", "Valheim 2"] });
    const ambiguous = await createSessionFromDiscord({
      userId: USER,
      communityId: "community-1",
      gameQuery: "val",
      dateStr: "2026-12-05",
      timeStr: "21:00",
      places: 4,
    });
    expect(ambiguous.status).toBe("GAME_AMBIGUOUS");
    expect(mocks.createInTx).not.toHaveBeenCalled();
  });

  it("annonce la création sans promettre d’annonce Discord", async () => {
    const content = await deferredContent(
      handleSignedSessionInteraction(
        interaction("creer", [
          { name: "jeu", value: "valheim" },
          { name: "date", value: "2026-12-05" },
          { name: "heure", value: "21:00" },
          { name: "places", value: 6 },
        ]),
        now()
      )
    );
    expect(content).toContain("Soirée créée");
    expect(content).toContain("visible dans GameNight");
  });
});
