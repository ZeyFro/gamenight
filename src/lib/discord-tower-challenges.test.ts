import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(), actor: vi.fn(), claim: vi.fn(), state: vi.fn(), proof: vi.fn(), vote: vi.fn(), settle: vi.fn(),
  edit: vi.fn(), readProof: vi.fn(), leaderboard: vi.fn(), seasonVote: vi.fn(), seasonBallot: vi.fn(),
  teams: vi.fn(), teamChallenge: vi.fn(), joinTeam: vi.fn(),
}));
vi.mock("@/lib/discord-signature", () => ({ verifyDiscordSignature: mocks.verify }));
vi.mock("@/lib/community-setup", () => ({ setupCommunityFromGuild: vi.fn() }));
vi.mock("@/lib/discord-session-rsvp", () => ({ respondToSessionRsvp: vi.fn() }));
vi.mock("@/lib/discord-instant-session-rsvp", () => ({ respondToInstantSessionRsvp: vi.fn() }));
vi.mock("@/lib/discord-tournament-rsvp", () => ({ respondToTournamentRsvp: vi.fn() }));
vi.mock("@/lib/discord-rest", () => ({ editSetupResponse: mocks.edit, getTowerProofMessage: mocks.readProof }));
vi.mock("@/lib/tower-challenges", () => ({
  resolveTowerDiscordActor: mocks.actor, claimSoloTowerChallenge: mocks.claim, getTowerChallengeState: mocks.state,
  submitTowerChallengeProof: mocks.proof, voteTowerChallenge: mocks.vote, settleTowerChallenge: mocks.settle,
  getTowerSeasonLeaderboard: mocks.leaderboard, getTowerSeasonVote: mocks.seasonVote,
  castTowerSeasonVote: mocks.seasonBallot,
  listDiscordTowerTeams: mocks.teams, getTeamDailyTowerChallenge: mocks.teamChallenge, joinTowerTeamChallenge: mocks.joinTeam,
}));
import { handleDiscordInteraction } from "./discord-interactions";
import commands from "../../scripts/discord-commands.json";

const app = "100000000000000001", guild = "100000000000000002", channel = "100000000000000003";
const user = "100000000000000004", message = "100000000000000005";
const actor = { communityId: "tower-community", userId: "tower-user" };
const payload = (custom_id = "gn:tower:claim", over: Record<string, unknown> = {}) => ({
  type: 3, id: "100000000000000006", application_id: app, token: "simulation-token",
  guild_id: guild, channel_id: channel, member: { user: { id: user, username: "Joueur" } },
  message: { id: message, author: { id: app, bot: true } }, data: { custom_id, component_type: 2 }, ...over,
});
const run = (body = payload(), timestamp = String(Math.floor(Date.now() / 1000))) => handleDiscordInteraction({
  rawBody: JSON.stringify(body), timestamp, signature: "simulated-signature",
});
const modal = (link = `https://discord.com/channels/${guild}/${channel}/${message}`, consent = "OUI") => payload("gn:tower:proof:attempt_1", {
  type: 5, data: { custom_id: "gn:tower:proof:attempt_1", components: [
    { type: 1, components: [{ type: 4, custom_id: "proof_link", value: link }] },
    { type: 1, components: [{ type: 4, custom_id: "proof_text", value: "Ma construction" }] },
    { type: 1, components: [{ type: 4, custom_id: "publication", value: consent }] },
  ] },
});

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  vi.stubEnv("DISCORD_APP_PUBLIC_KEY", "ab".repeat(32));
  vi.stubEnv("DISCORD_CLIENT_ID", app);
  vi.stubEnv("TOWER_CHALLENGES_ENABLED", "true");
  vi.stubEnv("TOWER_DISCORD_GUILD_ID", guild);
  vi.stubEnv("TOWER_DISCORD_CHANNEL_ID", channel);
  mocks.verify.mockReturnValue(true);
  mocks.actor.mockResolvedValue(actor);
  mocks.claim.mockResolvedValue({ status: "CLAIMED", attemptId: "attempt_1", replayed: false });
  mocks.state.mockResolvedValue({ status: "STATE", floor: "1", attempts: [{
    id: "attempt_1", title: "Construis", instructions: "Une maison", status: "ASSIGNED", rewardFloors: 2,
    assignedAt: new Date(), expiresAt: new Date(Date.now() + 48 * 3600000), submittedAt: null,
  }] });
  mocks.edit.mockResolvedValue({ ok: true, data: { messageId: message, channelId: channel } });
  mocks.readProof.mockResolvedValue({ ok: true, data: { messageId: message, channelId: channel, authorId: user } });
  mocks.proof.mockResolvedValue({ status: "SUBMITTED", replayed: false });
  mocks.vote.mockResolvedValue({ status: "VOTED", replayed: false });
  mocks.settle.mockResolvedValue({ status: "OPEN" });
  mocks.seasonVote.mockResolvedValue({ status: "VOTE_OPEN", voteId: "vote_1",
    season: { name: "Trimestre 3", active: false, startAt: new Date("2026-04-01T00:00:00Z"), endAt: new Date("2026-07-01T00:00:00Z") },
    closesAt: new Date(Date.now() + 24 * 3600000), myCandidateUserId: null, candidates: [
      { userId: "candidate_1", discordId: "100000000000000007", displayName: "Joueur A", rewardFloors: 5, votes: 0 },
      { userId: "candidate_2", discordId: "100000000000000008", displayName: "Joueur B", rewardFloors: 4, votes: 0 },
    ] });
  mocks.seasonBallot.mockResolvedValue({ status: "SEASON_VOTE_SAVED" });
  mocks.teams.mockResolvedValue({ status: "TEAMS", teams: [{ id: "team_1", name: "Les grimpeurs" }] });
  mocks.teamChallenge.mockResolvedValue({ status: "TEAM_CHALLENGE", team: { id: "team_1", name: "Les grimpeurs", memberCount: 3 },
    attempt: { id: "team_attempt_1", title: "Le défi collectif", instructions: "Jouez ensemble.", rewardFloors: 2,
      status: "ASSIGNED", assignedAt: new Date(), expiresAt: new Date(Date.now() + 48 * 3600000), submittedAt: null },
    participantCount: 1, joined: false, pendingReward: false });
  mocks.joinTeam.mockResolvedValue({ status: "JOINED", teamId: "team_1", replayed: false });
  mocks.leaderboard.mockResolvedValue({ status: "LEADERBOARD", season: { name: "Trimestre 1", active: true,
    startAt: new Date("2026-09-01T00:00:00Z"), endAt: new Date("2027-01-01T00:00:00Z") }, entries: [
      { discordId: "100000000000000004", rewardFloors: 5 }, { discordId: "100000000000000007", rewardFloors: 3 },
    ] });
});
afterEach(() => vi.unstubAllEnvs());

describe("parcours Discord The Tower signé", () => {
  it("ACK avant toute base ou publication puis attribue au membre signé", async () => {
    const out = await run();
    expect(out.body).toEqual({ type: 5, data: { flags: 64 } });
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.edit).not.toHaveBeenCalled();
    await out.runTower?.();
    expect(mocks.actor).toHaveBeenCalledWith({ guildId: guild, discordId: user, username: "Joueur" });
    expect(mocks.claim).toHaveBeenCalledWith({ ...actor, requestKey: "100000000000000006" });
    expect(mocks.edit).toHaveBeenCalledWith(expect.objectContaining({ components: expect.any(Array) }));
  });
  it("n'ouvre aucun accès si la signature ou un drapeau est absent", async () => {
    mocks.verify.mockReturnValue(false);
    expect((await run()).status).toBe(401);
    mocks.verify.mockReturnValue(true); vi.stubEnv("TOWER_CHALLENGES_ENABLED", "false");
    expect((await run()).body).toMatchObject({ type: 4 });
    expect(mocks.actor).not.toHaveBeenCalled();
  });
  it.each([
    { guild_id: "200000000000000002" }, { channel_id: "200000000000000003" },
    { application_id: "200000000000000001" }, { guild_id: undefined, member: undefined, user: { id: user } },
    { message: { id: message, author: { id: user, bot: false } } },
    { member: { user: { id: user, username: "Robot", bot: true } } },
  ])("refuse un contexte incorrect %j", async over => {
    expect((await run(payload("gn:tower:claim", over))).status).toBe(400);
    expect(mocks.actor).not.toHaveBeenCalled();
  });
  it("refuse les interactions anciennes ou les actions inconnues", async () => {
    expect((await run(payload(), String(Math.floor(Date.now() / 1000) - 301))).status).toBe(400);
    expect((await run(payload("gn:tower:erase:attempt_1"))).status).toBe(400);
  });
  it("ouvre le formulaire de preuve sans appel externe", async () => {
    const out = await run(payload("gn:tower:proof:attempt_1"));
    expect(out.body).toMatchObject({ type: 9, data: { custom_id: "gn:tower:proof:attempt_1" } });
    expect(mocks.actor).not.toHaveBeenCalled();
    expect(mocks.readProof).not.toHaveBeenCalled();
  });
  it("enregistre une preuve consentie dont le message appartient au membre", async () => {
    const out = await run(modal()); await out.runTower?.();
    expect(mocks.readProof).toHaveBeenCalledWith(expect.objectContaining({ channelId: channel, messageId: message }));
    expect(mocks.proof).toHaveBeenCalledWith({ ...actor, attemptId: "attempt_1", proofText: "Ma construction",
      proofChannelId: channel, proofMessageId: message, publicationConsent: true });
  });
  it.each([
    "https://example.com/preuve",
    `https://discord.com/channels/200000000000000002/${channel}/${message}`,
    `https://discord.com/channels/${guild}/200000000000000003/${message}`,
  ])("refuse un lien de preuve hors périmètre : %s", async link => {
    expect((await run(modal(link))).status).toBe(400);
    expect(mocks.readProof).not.toHaveBeenCalled();
  });
  it("permet une preuve sans publication publique", async () => {
    const out = await run(modal(undefined, "NON")); await out.runTower?.();
    expect(out.body).toMatchObject({ type: 5, data: { flags: 64 } });
    expect(mocks.readProof).toHaveBeenCalledWith(expect.objectContaining({ channelId: channel, messageId: message }));
    expect(mocks.proof).toHaveBeenCalledWith({ ...actor, attemptId: "attempt_1", proofText: "Ma construction",
      proofChannelId: channel, proofMessageId: message, publicationConsent: false });
  });
  it("refuse une valeur de consentement inconnue sans lire le message", async () => {
    expect((await run(modal(undefined, "PEUT-ÊTRE"))).status).toBe(400);
    expect(mocks.readProof).not.toHaveBeenCalled();
  });
  it("ne valide pas la preuve d'un autre auteur ou un message inaccessible", async () => {
    for (const response of [{ ok: true, data: { messageId: message, channelId: channel, authorId: app } }, { ok: false, kind: "not_found" }]) {
      mocks.readProof.mockResolvedValue(response);
      const out = await run(modal()); await out.runTower?.();
    }
    expect(mocks.proof).not.toHaveBeenCalled();
  });
  it("conserve un vote et une clôture au nom du membre réel", async () => {
    const out = await run(payload("gn:tower:vote:attempt_1:yes")); await out.runTower?.();
    expect(mocks.vote).toHaveBeenCalledWith({ ...actor, attemptId: "attempt_1", approve: true });
    const end = await run(payload("gn:tower:settle:attempt_1")); await end.runTower?.();
    expect(mocks.settle).toHaveBeenCalledWith({ ...actor, attemptId: "attempt_1" });
  });
  it("n'annonce pas un étage d'équipe crédité si le membre attend le lendemain", async () => {
    mocks.settle.mockResolvedValueOnce({ status: "APPROVED", team: true, userRewarded: false, pendingRewards: 1 });
    const out = await run(payload("gn:tower:settle:team_attempt"));
    await out.runTower?.();
    const content = mocks.edit.mock.calls.at(-1)?.[0].content;
    expect(content).toContain("récompense sera créditée demain");
    expect(content).not.toContain("Ton étage a été mis à jour");
  });
  it("ouvre et rejoint le défi quotidien partagé de l'équipe", async () => {
    const out = await run(payload("", { type: 2, message: undefined,
      data: { name: "tower", options: [{ type: 1, name: "equipe" }] } }));
    await out.runTower?.();
    expect(mocks.teams).toHaveBeenCalledWith(actor);
    expect(mocks.edit.mock.calls.at(-1)?.[0].components[0].components[0]).toMatchObject({
      label: "Les grimpeurs", custom_id: "gn:tower:team:team_1",
    });
    const team = await run(payload("gn:tower:team:team_1"));
    await team.runTower?.();
    expect(mocks.teamChallenge).toHaveBeenCalledWith({ ...actor, teamId: "team_1" });
    expect(mocks.edit.mock.calls.at(-1)?.[0].content).toContain("Défi quotidien");

    mocks.teamChallenge.mockResolvedValueOnce({ status: "TEAM_CHALLENGE", team: { id: "team_1", name: "Les grimpeurs", memberCount: 3 },
      attempt: { id: "team_attempt_1", title: "Le défi collectif", instructions: "Jouez ensemble.", rewardFloors: 2,
        status: "ASSIGNED", assignedAt: new Date(), expiresAt: new Date(Date.now() + 48 * 3600000), submittedAt: null },
      participantCount: 2, joined: true, pendingReward: false });
    const join = await run(payload("gn:tower:join:team_attempt_1"));
    await join.runTower?.();
    expect(mocks.joinTeam).toHaveBeenCalledWith({ ...actor, attemptId: "team_attempt_1" });
    expect(mocks.edit.mock.calls.at(-1)?.[0].content).toContain("Tu participes à ce défi d'équipe.");
  });
  it("refuse un acteur indisponible et masque les erreurs internes", async () => {
    mocks.actor.mockResolvedValue(null);
    const out = await run(); await out.runTower?.();
    expect(mocks.claim).not.toHaveBeenCalled();
    mocks.actor.mockRejectedValue(new Error("secret à ne pas afficher"));
    const failed = await run(); await failed.runTower?.();
    expect(mocks.edit.mock.calls.at(-1)?.[0].content).not.toContain("secret");
  });
  it("permet de retrouver un ancien défi encore valable après un nouveau tirage", async () => {
    const fields = { instructions: "Construis librement", status: "ASSIGNED", rewardFloors: 1,
      assignedAt: new Date(), expiresAt: new Date(Date.now() + 48 * 3600000), submittedAt: null };
    mocks.state.mockResolvedValue({ status: "STATE", floor: "1", attempts: [
      { ...fields, id: "latest", title: "Nouveau défi" }, { ...fields, id: "older", title: "Ancien défi" },
    ] });
    const mine = await run(payload("gn:tower:mine"));
    await mine.runTower?.();
    expect(JSON.stringify(mocks.edit.mock.calls[0][0].components)).toContain("gn:tower:view:older");
    const older = await run(payload("gn:tower:view:older"));
    await older.runTower?.();
    expect(mocks.state).toHaveBeenLastCalledWith({ ...actor, attemptId: "older" });
  });
  it.each(["defi", "progression"])("commande /tower %s privée, sans toucher à la commande d'administration", async name => {
    const out = await run(payload("", { type: 2, message: undefined, data: { name: "tower", options: [{ name, type: 1 }] } }));
    expect(out.body).toEqual({ type: 5, data: { flags: 64 } });
    expect(mocks.actor).not.toHaveBeenCalled();
    await out.runTower?.();
    expect(mocks.actor).toHaveBeenCalledWith({ guildId: guild, discordId: user, username: "Joueur" });
    expect(mocks.claim).toHaveBeenCalledTimes(name === "defi" ? 1 : 0);
    expect(mocks.state).toHaveBeenCalledTimes(1);
    expect(commands.find(command => command.name === "gamenight")?.default_member_permissions).toBe("32");
    expect(commands.find(command => command.name === "tower")?.options.map(option => option.name)).toEqual(["defi", "progression", "classement", "vote", "equipe"]);
  });
  it("affiche le classement saisonnier sur plusieurs lignes", async () => {
    const out = await run(payload("", { type: 2, message: undefined,
      data: { name: "tower", options: [{ name: "classement", type: 1 }] } }));
    await out.runTower?.();
    expect(mocks.leaderboard).toHaveBeenCalledWith(actor);
    const content = mocks.edit.mock.calls[0][0].content;
    expect(content).toContain("**Classement The Tower — Trimestre 1**");
    expect(content).toContain("\n");
    expect(content).toContain("1. <@100000000000000004>");
    expect(content).toContain("2. <@100000000000000007>");
    expect(content).not.toContain("\\n");
  });
  it("ouvre et fait voter dans le scrutin de fin de saison du bot", async () => {
    const command = await run(payload("", { type: 2, message: undefined,
      data: { name: "tower", options: [{ name: "vote", type: 1 }] } }));
    await command.runTower?.();
    expect(mocks.seasonVote).toHaveBeenCalledWith(actor);
    expect(mocks.edit.mock.calls[0][0].content).toContain("Vote communautaire");
    expect(mocks.edit.mock.calls[0][0].components).toEqual(expect.arrayContaining([
      expect.objectContaining({ components: expect.arrayContaining([
        expect.objectContaining({ custom_id: "gn:tower:season-ballot:vote_1:candidate_1" }),
      ]) }),
    ]));
    mocks.seasonVote.mockResolvedValueOnce({ status: "VOTE_OPEN", voteId: "vote_1",
      season: { name: "Trimestre 3", active: false, startAt: new Date(), endAt: new Date() },
      closesAt: new Date(Date.now() + 24 * 3600000), myCandidateUserId: null,
      candidates: [{ userId: "candidate_1", discordId: "100000000000000007", displayName: "Joueur A", rewardFloors: 5, votes: 0 }] });
    const ballot = await run(payload("gn:tower:season-ballot:vote_1:candidate_1"));
    await ballot.runTower?.();
    expect(mocks.seasonBallot).toHaveBeenCalledWith({ ...actor, voteId: "vote_1", candidateUserId: "candidate_1" });
    expect(mocks.edit.mock.calls.at(-1)?.[0].content).toContain("Ton vote de saison est enregistré.");
    mocks.seasonVote.mockResolvedValueOnce({ status: "VOTE_CLOSED", voteId: "vote_1",
      season: { name: "Trimestre 3", active: false, startAt: new Date(), endAt: new Date() },
      closesAt: new Date(Date.now() - 1), myCandidateUserId: null,
      candidates: [
        { userId: "candidate_2", discordId: "100000000000000008", displayName: "Joueur B", rewardFloors: 3, votes: 5 },
        { userId: "candidate_1", discordId: "100000000000000007", displayName: "Joueur A", rewardFloors: 5, votes: 2 },
      ] });
    const closed = await run(payload("", { type: 2, message: undefined,
      data: { name: "tower", options: [{ name: "vote", type: 1 }] } }));
    await closed.runTower?.();
    expect(mocks.edit.mock.calls.at(-1)?.[0].content).toContain("🏆 Distinction de saison");
    expect(mocks.edit.mock.calls.at(-1)?.[0].components).toBeUndefined();
  });
  it("refuse une sous-commande Tower inconnue plutôt que d'exécuter un défi", async () => {
    const out = await run(payload("", { type: 2, message: undefined, data: { name: "tower", options: [{ name: "setup", type: 1 }] } }));
    expect(out.status).toBe(400);
    expect(mocks.actor).not.toHaveBeenCalled();
  });

});
