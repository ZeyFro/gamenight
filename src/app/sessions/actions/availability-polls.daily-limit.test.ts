import { beforeEach, describe, expect, it, vi } from "vitest";

/** Plafond de 10 soirées par jour (audit 1.14) — choisir un créneau de sondage crée une `Session` : refus clair, sans XP. */
const mocks = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  checkRateLimit: vi.fn(),
  redirect: vi.fn((location: string) => {
    throw new Error(`REDIRECT:${location}`);
  }),
  choose: vi.fn(),
  awardXp: vi.fn(),
  AvailabilityPollError: class AvailabilityPollError extends Error {},
}));

vi.mock("@/lib/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/badges", () => ({ checkSessionsCreatedBadges: vi.fn() }));
vi.mock("@/lib/xp-actions", () => ({ awardXp: mocks.awardXp }));
vi.mock("@/lib/creation-resume", () => ({ resumeCreation: vi.fn(async () => null) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/session-availability-poll-data", () => ({
  AvailabilityPollError: mocks.AvailabilityPollError,
  chooseAvailabilityPollSlot: mocks.choose,
  answerAvailabilityPoll: vi.fn(),
  closeAvailabilityPoll: vi.fn(),
  createAvailabilityPoll: vi.fn(),
}));

import { DailyCreationLimitError } from "@/lib/creation-quota";
import { chooseAvailabilityPollSlotAction } from "./availability-polls";

function form(): FormData {
  const fd = new FormData();
  fd.set("pollId", "poll-1");
  fd.set("slotId", "slot-1");
  return fd;
}

describe("chooseAvailabilityPollSlotAction — plafond de soirées par jour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue({ id: "creator" });
    mocks.checkRateLimit.mockReturnValue(true);
  });

  it("au-delà du plafond : redirection vers le sondage avec le code de quota, aucun XP", async () => {
    mocks.choose.mockRejectedValue(new DailyCreationLimitError("SESSION"));
    await expect(chooseAvailabilityPollSlotAction(form())).rejects.toThrow("REDIRECT:/sessions/sondages/poll-1?error=quota_soirees_jour");
    expect(mocks.awardXp).not.toHaveBeenCalled();
  });

  it("l'erreur existante « indisponible » est inchangée", async () => {
    mocks.choose.mockRejectedValue(new mocks.AvailabilityPollError("x"));
    await expect(chooseAvailabilityPollSlotAction(form())).rejects.toThrow("REDIRECT:/sessions/sondages/poll-1?error=unavailable");
  });
});
