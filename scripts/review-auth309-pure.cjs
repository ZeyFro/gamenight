// Review evidence: run with `node scripts/review-auth309-pure.cjs`; no database or HTTP.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
let config;
let membershipReads = 0;
let activeIds = ['B'];
const user = { id: 'user-B', discordId: '222' };
const prisma = {
  user: { upsert: async () => user, findUnique: async () => user },
  membership: { findMany: async () => {
    membershipReads++;
    return activeIds.map(communityId => ({ communityId, community: { slug: 'serveur-b' } }));
  } },
  $transaction: async callback => callback(prisma),
};
const stubs = {
  'next-auth': { default: value => { config = value; return {}; }, __esModule: true },
  'next-auth/providers/discord': { default: value => value, __esModule: true },
  '@/lib/prisma': { prisma },
  '@/lib/discord-token-crypto': {},
  '@/lib/logger': { logger: { warn() {}, error() {} } },
  '@/lib/discord-user-guilds': { listOAuthUserGuildIds: async () => ['222'] },
  '@/lib/community-oauth': { syncOAuthMemberships: async () => activeIds },
  '@/lib/default-community': {
    DEFAULT_COMMUNITY_SLUG: 'default',
    ensureDefaultCommunityRecord: async () => ({}),
    getDefaultCommunityId: async () => 'A-default',
  },
  '@/lib/community-picker': { isCommunityPickerEnabled: () => false },
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', source)(name =>
    Object.hasOwn(stubs, name) ? stubs[name] : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts') : require(name),
  module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}
async function main() {
  process.env.COMMUNITY_ISOLATION_ENABLED = 'false';
  process.env.COMMUNITY_PICKER_ENABLED = 'false';
  process.env.ADMIN_DISCORD_IDS = '999';
  process.env.DISCORD_CLIENT_ID = 'review';
  process.env.DISCORD_CLIENT_SECRET = 'fake';
  load('src/auth.ts');
  const isolation = load('src/lib/community-isolation.ts');
  const scoped = load('src/lib/community-scoped-client.ts');
  const stats = load('src/lib/community-stats.ts');
  const call = id => config.callbacks.signIn({ user: { id, name: 'test' }, profile: { id, username: 'test' }, account: { access_token: 'fake', scope: 'guilds' } });
  assert.equal(await call('222'), true);
  const scope = await isolation.getIsolationScope('user-B');
  assert.equal(scope, null);
  assert.deepEqual(isolation.communityIdFilter(scope), {});
  assert.deepEqual(scoped.scopeQueryArgs('Tournament', 'findMany', { where: { status: 'REGISTRATION' } }, scope), { where: { status: 'REGISTRATION' } });
  assert.equal(await stats.writeCommunityIdForUser('user-B'), 'A-default');
  activeIds = [];
  assert.equal(await call('999'), true);
  assert.deepEqual(isolation.communityIdFilter(await isolation.getIsolationScope('admin-no-membership')), {});
  assert.equal(await stats.writeCommunityIdForUser('admin-no-membership'), 'A-default');
  assert.equal(membershipReads, 0);
  console.log('CONFIRMED: B-only admitted OFF; tournament query has no community filter; writes target A-default.');
  console.log('CONFIRMED: platform admin with zero memberships admitted OFF; same global read/default write behavior.');
  console.log('Pure assertions passed; OAuth and Prisma boundaries are simulated; application source is unchanged.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
