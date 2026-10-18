import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { currentUser, rateLimit, create, vote, revalidatePath } = vi.hoisted(() => ({ currentUser: vi.fn(), rateLimit: vi.fn(), create: vi.fn(), vote: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ getCurrentUser: currentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: rateLimit }));
vi.mock("@/lib/community-quick-polls", () => ({ createCommunityQuickPoll: create, voteCommunityQuickPoll: vote }));
vi.mock("@/lib/creation-intent", () => ({ creationKey: (value: unknown) => { if (typeof value !== "string" || value.length < 16) throw new Error("Clé invalide"); return value; } }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`); } }));
import { createCommunityQuickPollAction, voteCommunityQuickPollAction } from "./actions";

describe("sondages éclair : actions", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("COMMUNITY_QUICK_POLLS_ENABLED", "true");
    currentUser.mockResolvedValue({ id: "authenticated" }); rateLimit.mockReturnValue(true);
    create.mockResolvedValue("saved"); vote.mockResolvedValue("saved");
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([createCommunityQuickPollAction, voteCommunityQuickPollAction])("refuse le spam sans écrire", async action => {
    rateLimit.mockReturnValue(false);
    await expect(action(new FormData())).rejects.toThrow("?result=rate");
    expect(create).not.toHaveBeenCalled(); expect(vote).not.toHaveBeenCalled();
  });
  it.each([createCommunityQuickPollAction, voteCommunityQuickPollAction])("refuse un formulaire sans serveur affiché", async action => {
    await expect(action(new FormData())).rejects.toThrow("?result=invalid");
    expect(create).not.toHaveBeenCalled(); expect(vote).not.toHaveBeenCalled();
  });
  it("utilise l’utilisateur authentifié et la clé du geste de création", async () => {
    const form = new FormData();
    form.set("userId", "forged"); form.set("communityId", "displayed"); form.set("question", "On joue ?"); form.set("options", "Oui\nNon"); form.set("durationMinutes", "60"); form.set("creationKey", "quick-poll-creation-key");
    await expect(createCommunityQuickPollAction(form)).rejects.toThrow("?result=saved");
    expect(create).toHaveBeenCalledWith("authenticated", { question: "On joue ?", options: ["Oui", "Non"], durationMinutes: "60" }, "displayed", "quick-poll-creation-key");
    expect(revalidatePath).toHaveBeenCalledWith("/profil/lore/sondages");
  });
  it("ne permet pas de voter pour une autre identité", async () => {
    const form = new FormData(); form.set("userId", "forged"); form.set("communityId", "displayed"); form.set("pollId", "poll"); form.set("optionIndex", "0");
    await expect(voteCommunityQuickPollAction(form)).rejects.toThrow("?result=saved");
    expect(vote).toHaveBeenCalledWith("authenticated", "poll", "0", "displayed");
  });
  it("refuse un utilisateur déconnecté et le drapeau autre que true", async () => {
    currentUser.mockResolvedValue(null);
    await expect(voteCommunityQuickPollAction(new FormData())).rejects.toThrow("redirect:/");
    vi.stubEnv("COMMUNITY_QUICK_POLLS_ENABLED", "TRUE");
    await expect(createCommunityQuickPollAction(new FormData())).rejects.toThrow("redirect:/profil/lore");
    expect(create).not.toHaveBeenCalled(); expect(vote).not.toHaveBeenCalled();
  });
});
