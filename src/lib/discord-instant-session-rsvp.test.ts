import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(), session: vi.fn(), community: vi.fn(), membership: vi.fn(), delivery: vi.fn(),
  join: vi.fn(), leave: vi.fn(), rate: vi.fn(), revalidate: vi.fn(),
  receipts: new Map<string, unknown>(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: {
  user: { findUnique: mocks.user }, instantSession: { findUnique: mocks.session }, community: { findUnique: mocks.community },
  membership: { findUnique: mocks.membership }, notificationDelivery: { findFirst: mocks.delivery },
  // Reçu d'interaction : contrainte unique (category, eventType, sourceId, occurrence) simulée.
  notificationEvent: {
    create: vi.fn(async ({ data }: { data: { occurrence: string; payload: unknown } }) => {
      if (mocks.receipts.has(data.occurrence)) throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" });
      mocks.receipts.set(data.occurrence, data.payload);
      return data;
    }),
    findUnique: vi.fn(async ({ where }: { where: { category_eventType_sourceId_occurrence: { occurrence: string } } }) => {
      const payload = mocks.receipts.get(where.category_eventType_sourceId_occurrence.occurrence);
      return payload === undefined ? null : { payload };
    }),
    delete: vi.fn(async ({ where }: { where: { category_eventType_sourceId_occurrence: { occurrence: string } } }) => {
      mocks.receipts.delete(where.category_eventType_sourceId_occurrence.occurrence);
    }),
  },
} }));
vi.mock("@/lib/instant-sessions", () => ({ joinInstantSession: mocks.join, leaveInstantSession: mocks.leave }));
vi.mock("@/lib/community-scoped-client", () => ({ getScopedPrisma: vi.fn(async () => ({ instantSession: { findUnique: mocks.session } })) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rate, RATE_LIMIT_MESSAGE: "rate limited" }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));

import { respondToInstantSessionRsvp } from "@/lib/discord-instant-session-rsvp";

const origin = { interactionId: "123", discordId: "456", guildId: "789", channelId: "987", messageId: "654" };

describe("Discord instant-session RSVP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.receipts.clear();
    mocks.user.mockResolvedValue({ id: "user-1" });
    mocks.session.mockResolvedValue({ id: "session-1", communityId: "community-1" });
    mocks.community.mockResolvedValue({ id: "community-1", slug: "club", status: "ACTIVE", discordGuildId: "789" });
    mocks.membership.mockResolvedValue({ status: "ACTIVE" });
    mocks.delivery.mockResolvedValue({ id: "delivery-1" });
    mocks.rate.mockReturnValue(true);
    mocks.join.mockResolvedValue({ ok: true });
    mocks.leave.mockResolvedValue({ ok: true });
  });

  it("mutates only after resolving the linked account, active guild membership, and exact sent announcement", async () => {
    await expect(respondToInstantSessionRsvp("session-1", "join", origin)).resolves.toContain("rejoint");
    expect(mocks.delivery).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      targetSlot: "default-guild:INSTANT_SESSION:session-1:announce", discordMessageId: "654", discordChannelId: "987",
    }) }));
    expect(mocks.join).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("refuses a forged or stale message before changing participation", async () => {
    mocks.delivery.mockResolvedValue(null);
    await expect(respondToInstantSessionRsvp("session-1", "join", origin)).resolves.toContain("annonce");
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("keeps leave idempotent through the existing session mutation", async () => {
    await expect(respondToInstantSessionRsvp("session-1", "leave", origin)).resolves.toContain("quitté");
    expect(mocks.leave).toHaveBeenCalledWith("session-1", "user-1");
  });

  it("ne rejoue pas une interaction déjà traitée : un clic Discord rejoué après un départ ne réinscrit pas", async () => {
    const first = { ...origin, interactionId: "100" };
    await respondToInstantSessionRsvp("session-1", "join", first);
    await respondToInstantSessionRsvp("session-1", "leave", { ...origin, interactionId: "101" });
    await respondToInstantSessionRsvp("session-1", "join", first); // même interactionId rejoué
    expect(mocks.join).toHaveBeenCalledTimes(1);
    expect(mocks.leave).toHaveBeenCalledTimes(1);
  });

  it("refuse une interaction rejouée par un autre compte ou avec une autre action", async () => {
    await respondToInstantSessionRsvp("session-1", "join", origin);
    mocks.user.mockResolvedValue({ id: "user-2" });
    await respondToInstantSessionRsvp("session-1", "join", origin);
    mocks.user.mockResolvedValue({ id: "user-1" });
    await respondToInstantSessionRsvp("session-1", "leave", origin);
    expect(mocks.join).toHaveBeenCalledTimes(1);
    expect(mocks.leave).not.toHaveBeenCalled();
  });

  it("libère le reçu si la mutation échoue, pour qu'une relance légitime passe", async () => {
    mocks.join.mockRejectedValueOnce(new Error("db"));
    await expect(respondToInstantSessionRsvp("session-1", "join", origin)).rejects.toThrow("db");
    await expect(respondToInstantSessionRsvp("session-1", "join", origin)).resolves.toContain("rejoint");
    expect(mocks.join).toHaveBeenCalledTimes(2);
  });
});
