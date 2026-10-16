import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), tournament: vi.fn(), community: vi.fn(), membership: vi.fn(), delivery: vi.fn(), register: vi.fn(), rate: vi.fn(), revalidate: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: mocks.user }, tournament: { findUnique: mocks.tournament }, community: { findUnique: mocks.community },
  membership: { findUnique: mocks.membership }, notificationDelivery: { findFirst: mocks.delivery },
} }));
vi.mock("@/lib/tournament-registration", () => ({ registerTournamentParticipant: mocks.register }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn(async () => ({ tournament: { findUnique: mocks.tournament } })) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, RATE_LIMIT_MESSAGE: "rate limited" }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { respondToTournamentRsvp } from "@/lib/discord-tournament-rsvp";

const origin = { interactionId: "123", discordId: "456", guildId: "789", channelId: "987", messageId: "654" };

describe("Discord tournament RSVP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.user.mockResolvedValue({ id: "user-1" });
    mocks.tournament.mockResolvedValue({ id: "tournament-1", status: "REGISTRATION", communityId: "community-1", discordGuildId: "789", discordChannelId: "987" });
    mocks.community.mockResolvedValue({ id: "community-1", slug: "club", status: "ACTIVE" });
    mocks.membership.mockResolvedValue({ status: "ACTIVE" });
    mocks.delivery.mockResolvedValue({ id: "delivery-1" });
    mocks.register.mockResolvedValue("registered");
    mocks.rate.mockReturnValue(true);
  });

  it("checks the linked member and exact delivered announcement before registration", async () => {
    await expect(respondToTournamentRsvp("tournament-1", origin)).resolves.toContain("confirmée");
    expect(mocks.delivery).toHaveBeenCalledWith({ where: expect.objectContaining({
      targetSlot: "default-guild:TOURNAMENT:tournament-1:announce", discordMessageId: "654", discordChannelId: "987",
    }), select: { id: true } });
    expect(mocks.register).toHaveBeenCalledWith("user-1", "tournament-1");
  });

  it("refuses a different Discord guild before registering", async () => {
    await expect(respondToTournamentRsvp("tournament-1", { ...origin, guildId: "000" })).resolves.toContain("fermées");
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it("reports an already registered participant without incrementing through another path", async () => {
    mocks.register.mockResolvedValue("already");
    await expect(respondToTournamentRsvp("tournament-1", origin)).resolves.toContain("déjà inscrit");
    expect(mocks.register).toHaveBeenCalledOnce();
  });
});
