import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommunityStatus } from "@prisma/client";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

vi.mock("@/lib/prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: TEST_DATABASE_URL ? new PrismaClient({ datasourceUrl: TEST_DATABASE_URL }) : {} };
});

if (!TEST_DATABASE_URL) console.warn("[community-channels-creation.integration] TEST_DATABASE_URL absente — suite PostgreSQL ignorée.");

describe.skipIf(!TEST_DATABASE_URL)("community-channels creation scope (Postgres)", () => {
  let db: import("@prisma/client").PrismaClient;
  let pickCreationCommunityAndRecipients: typeof import("./community-channels").pickCreationCommunityAndRecipients;
  let resetDefaultCommunityIdCache: typeof import("./default-community").resetDefaultCommunityIdCache;
  let defaultCommunity: { id: string; status: CommunityStatus } | null = null;
  let priorDefaultStatus: CommunityStatus | null = null;
  let createdDefault = false;
  let createdCommunityIds: string[] = [];
  let createdUserIds: string[] = [];

  beforeAll(async () => {
    db = (await import("@/lib/prisma")).prisma as unknown as typeof db;
    ({ pickCreationCommunityAndRecipients } = await import("./community-channels"));
    ({ resetDefaultCommunityIdCache } = await import("./default-community"));
  });

  afterAll(async () => {
    await db.$disconnect();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    vi.stubEnv("COMMUNITY_CHANNELS_ENABLED", "false");
    vi.stubEnv("COMMUNITY_ISOLATION_ENABLED", "false");
    vi.stubEnv("COMMUNITY_PICKER_ENABLED", "false");
    resetDefaultCommunityIdCache();
    createdCommunityIds = [];
    createdUserIds = [];
    createdDefault = false;
    priorDefaultStatus = null;

    const existingDefault = await db.community.findUnique({ where: { slug: "default" }, select: { id: true, status: true } });
    if (existingDefault) {
      defaultCommunity = existingDefault;
      priorDefaultStatus = existingDefault.status;
      if (existingDefault.status !== "ACTIVE") {
        defaultCommunity = await db.community.update({ where: { id: existingDefault.id }, data: { status: "ACTIVE" }, select: { id: true, status: true } });
      }
    } else {
      defaultCommunity = await db.community.create({ data: { slug: "default", name: "Default", status: "ACTIVE" }, select: { id: true, status: true } });
      createdDefault = true;
    }
  });

  afterEach(async () => {
    if (createdUserIds.length) {
      await db.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
      await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (createdCommunityIds.length) await db.community.deleteMany({ where: { id: { in: createdCommunityIds } } });
    if (createdDefault && defaultCommunity) await db.community.delete({ where: { id: defaultCommunity.id } });
    else if (defaultCommunity && priorDefaultStatus && priorDefaultStatus !== "ACTIVE") {
      await db.community.update({ where: { id: defaultCommunity.id }, data: { status: priorDefaultStatus } });
    }
    defaultCommunity = null;
    resetDefaultCommunityIdCache();
  });

  async function makeUser(label: string) {
    const id = randomUUID();
    const user = await db.user.create({ data: { discordId: `auth309-${label}-${id}`, discordName: `auth309-${label}` } });
    createdUserIds.push(user.id);
    return user;
  }

  it("B-only/isolation OFF : conserve B, garde l'invité B et écarte l'invité default", async () => {
    const communityB = await db.community.create({ data: { slug: `auth309-b-${randomUUID()}`, name: "Serveur B", status: "ACTIVE" } });
    createdCommunityIds.push(communityB.id);
    const creator = await makeUser("creator-b");
    const guestB = await makeUser("guest-b");
    const guestDefault = await makeUser("guest-default");
    await db.membership.createMany({ data: [
      { communityId: communityB.id, userId: creator.id, status: "ACTIVE" },
      { communityId: communityB.id, userId: guestB.id, status: "ACTIVE" },
      { communityId: defaultCommunity!.id, userId: guestDefault.id, status: "ACTIVE" },
    ] });

    await expect(pickCreationCommunityAndRecipients(creator.id, [guestB.id, guestDefault.id])).resolves.toEqual({
      communityId: communityB.id,
      notifiedUserIds: [guestB.id],
    });
  });

  it("sans membership créateur : aucun rattachement implicite ni destinataire default", async () => {
    const creator = await makeUser("creator-none");
    const guestDefault = await makeUser("guest-default");
    await db.membership.create({ data: { communityId: defaultCommunity!.id, userId: guestDefault.id, status: "ACTIVE" } });

    await expect(pickCreationCommunityAndRecipients(creator.id, [guestDefault.id])).resolves.toEqual({
      communityId: null,
      notifiedUserIds: [],
    });
  });
});
