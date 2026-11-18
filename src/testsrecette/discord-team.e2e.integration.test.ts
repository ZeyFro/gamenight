import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Chaîne réelle commande → accès communautaire → transaction SQL ; seul Discord est simulé.
const url = process.env.TEST_DATABASE_URL;
if (url) {
  const parsed = new URL(url);
  const isolatedDatabase = parsed.pathname === '/gamenight_test' || /^\/gamenight_quality_[a-zA-Z0-9_]+$/.test(parsed.pathname);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1' || !isolatedDatabase || url.includes('?') || url.includes('#')) {
    throw new Error('Recette réservée à PostgreSQL 127.0.0.1, base gamenight_test ou gamenight_quality_*, sans paramètres ni fragment');
  }
}
const { edit, network } = vi.hoisted(() => ({ edit: vi.fn(), network: vi.fn(() => { throw new Error('Réseau interdit pendant la recette'); }) }));
vi.mock('@/lib/discord-rest', () => ({ editSetupResponse: edit }));
if (!url) console.warn('[recette /equipe] TEST_DATABASE_URL absente : SKIPPÉE');

describe.skipIf(!url)('/equipe : commande et PostgreSQL local, Discord simulé', () => {
  let db: import('@prisma/client').PrismaClient;
  let command: typeof import('@/lib/discord-team-command');
  let teams: typeof import('@/lib/community-teams');
  const guild = '123456789012345678';
  const discordId = '234567890123456789';
  let communityId: string;
  let otherId: string;
  let leaderId: string;
  let playerId: string;
  let teamId: string;

  beforeAll(async () => {
    db = (await import('@/lib/prisma')).prisma;
    command = await import('@/lib/discord-team-command');
    teams = await import('@/lib/community-teams');
  });
  afterAll(async () => { await db?.$disconnect(); });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', network);
    vi.stubEnv('COMMUNITY_ISOLATION_ENABLED', 'true');
    vi.stubEnv('COMMUNITY_PICKER_ENABLED', 'true');
    edit.mockResolvedValue({ ok: true, data: { messageId: 'simulated' } });
    await db.$executeRawUnsafe('TRUNCATE "Community", "User", "Game" CASCADE');
    communityId = (await db.community.create({ data: { slug: 'quality-tower', name: 'Tower fictive', status: 'ACTIVE', discordGuildId: guild, communityTeamsEnabled: true } })).id;
    otherId = (await db.community.create({ data: { slug: 'quality-other', name: 'Autre serveur fictif', status: 'ACTIVE', communityTeamsEnabled: true } })).id;
    leaderId = (await db.user.create({ data: { discordId: '345678901234567890', discordName: 'Capitaine', activeCommunityId: communityId } })).id;
    playerId = (await db.user.create({ data: { discordId, discordName: 'Joueur', activeCommunityId: communityId } })).id;
    for (const userId of [leaderId, playerId]) await db.membership.create({ data: { userId, communityId, status: 'ACTIVE' } });
    const game = await db.game.create({ data: { name: 'Jeu fictif', source: 'MANUAL', addedById: leaderId } });
    expect(await teams.createCommunityTeam({ userId: leaderId, communityId, gameId: game.id, name: 'Expédition fictive', description: 'Une équipe pour la recette locale.', platform: 'PC', maxMembers: 4 })).toBe('created');
    teamId = (await db.communityTeam.findFirstOrThrow()).id;
  });

  async function run(action: 'liste' | 'moi' | 'rejoindre', id = teamId, beforeExecute?: () => Promise<unknown>) {
    const output = command.handleSignedTeamCommand({ type: 2, application_id: '456789012345678901', token: 'fictif', guild_id: guild, member: { user: { id: discordId } }, data: { name: 'equipe', options: [{ type: 1, name: action, ...(action === 'rejoindre' ? { options: [{ type: 3, name: 'equipe_id', value: id }] } : {}) }] } });
    expect(output.body).toEqual({ type: 5, data: { flags: 64 } });
    await beforeExecute?.();
    await output.runTeam?.();
    expect(network).not.toHaveBeenCalled();
    return edit.mock.calls.at(-1)?.[0].content as string;
  }

  it('liste, rejoint et retrouve son équipe ; rejouer ne duplique pas le membre', async () => {
    expect(await run('liste')).toContain(teamId);
    expect(await run('rejoindre')).toContain('Tu as rejoint');
    expect(await run('rejoindre')).toContain('déjà partie');
    expect(await run('moi')).toContain('Expédition fictive');
    expect(await db.communityTeamMember.count({ where: { teamId, userId: playerId } })).toBe(1);
  });

  it('refuse un identifiant réel d’un autre serveur sans créer de membre', async () => {
    await db.membership.create({ data: { userId: leaderId, communityId: otherId, status: 'ACTIVE' } });
    await db.user.update({ where: { id: leaderId }, data: { activeCommunityId: otherId } });
    const local = await db.communityTeam.findUniqueOrThrow({ where: { id: teamId } });
    expect(await teams.createCommunityTeam({ userId: leaderId, communityId: otherId, gameId: local.gameId, name: 'Équipe secrète', description: 'Équipe réservée au serveur voisin.', platform: 'PC', maxMembers: 4 })).toBe('created');
    const foreign = await db.communityTeam.findFirstOrThrow({ where: { communityId: otherId } });
    expect(await run('liste')).not.toContain(foreign.id);
    expect(await run('rejoindre', foreign.id)).toContain('pas accessible');
    expect(await db.communityTeamMember.count({ where: { userId: playerId } })).toBe(0);
  });

  it('revalide une appartenance retirée entre acquittement privé et exécution', async () => {
    expect(await run('rejoindre', teamId, () => db.membership.update({ where: { communityId_userId: { communityId, userId: playerId } }, data: { status: 'REMOVED' } }))).toContain('pas disponibles');
    expect(await db.communityTeamMember.count({ where: { userId: playerId } })).toBe(0);
  });
});
