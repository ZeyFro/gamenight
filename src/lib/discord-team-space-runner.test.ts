import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ provision: vi.fn(), reconcile: vi.fn(), member: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/discord-team-space-service", () => ({
  provisionTeamSpace: mocks.provision,
  reconcileTeamSpace: mocks.reconcile,
  syncTeamSpaceMember: mocks.member,
}));

import { runTeamSpaceAction } from "./discord-team-space-runner";

const api = {} as never;
const deadline = new Date(Date.now() + 20_000);
const base = { teamId: "team-1", communityId: "community-1" };
const DISCORD = "100000000000000022";

beforeEach(() => vi.clearAllMocks());

describe("runTeamSpaceAction (côté executor)", () => {
  it.each(["created", "reused"])("provision %s = succès", async (status) => {
    mocks.provision.mockResolvedValue({ status });
    expect(await runTeamSpaceAction({ ...base, intent: "provision" }, deadline, api)).toEqual({ ok: true, data: {} });
    expect(mocks.provision).toHaveBeenCalledWith({ ...base, api });
  });

  it.each(["partial", "failed"])("provision %s = échec retentable (borné par l'executor)", async (status) => {
    mocks.provision.mockResolvedValue({ status });
    expect(await runTeamSpaceAction({ ...base, intent: "provision" }, deadline, api)).toMatchObject({ ok: false, retryable: true });
  });

  it.each(["quota", "unmanaged", "disabled", "community_not_linked", "migration_required"])("provision %s = échec définitif, jamais rejoué", async (status) => {
    mocks.provision.mockResolvedValue({ status });
    expect(await runTeamSpaceAction({ ...base, intent: "provision" }, deadline, api)).toMatchObject({ ok: false, retryable: false });
  });

  it("reconcile : cohérent, réparé ou sans lien = succès ; ressource manquante = échec définitif", async () => {
    for (const status of ["consistent", "repaired", "unlinked"]) {
      mocks.reconcile.mockResolvedValue({ status, steps: [] });
      expect(await runTeamSpaceAction({ ...base, intent: "reconcile" }, deadline, api)).toEqual({ ok: true, data: {} });
    }
    mocks.reconcile.mockResolvedValue({ status: "partial", steps: ["channel_missing"] });
    // `partial` côté réconciliation = ressource disparue : on retente (le staff peut la rétablir) mais jamais de recréation.
    expect(await runTeamSpaceAction({ ...base, intent: "reconcile" }, deadline, api)).toMatchObject({ ok: false, retryable: true });
  });

  it("member : ajoute le rôle si l'équipe compte encore la personne, sinon le retire", async () => {
    mocks.member.mockResolvedValueOnce({ status: "updated" });
    expect(await runTeamSpaceAction({ ...base, intent: "member", discordId: DISCORD }, deadline, api)).toEqual({ ok: true, data: {} });
    expect(mocks.member).toHaveBeenCalledTimes(1);
    expect(mocks.member.mock.calls[0][0]).toMatchObject({ action: "join", discordId: DISCORD });

    mocks.member.mockReset();
    mocks.member.mockResolvedValueOnce({ status: "not_member" }).mockResolvedValueOnce({ status: "removed" });
    expect(await runTeamSpaceAction({ ...base, intent: "member", discordId: DISCORD }, deadline, api)).toEqual({ ok: true, data: {} });
    expect(mocks.member.mock.calls.map((call) => call[0].action)).toEqual(["join", "leave"]);
  });

  it("member sans identifiant Discord : échec définitif, aucun appel", async () => {
    expect(await runTeamSpaceAction({ ...base, intent: "member" }, deadline, api)).toMatchObject({ ok: false, retryable: false });
    expect(mocks.member).not.toHaveBeenCalled();
  });

  it("une exception du service devient un échec retentable, jamais un crash de l'executor", async () => {
    mocks.provision.mockRejectedValue(new Error("boom"));
    expect(await runTeamSpaceAction({ ...base, intent: "provision" }, deadline, api)).toMatchObject({ ok: false, retryable: true });
  });
});
