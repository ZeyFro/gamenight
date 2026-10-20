// Review evidence: coordinator grants the local PostgreSQL slot before execution.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const localRequire = createRequire(path.join(root, 'package.json'));
const ts = localRequire('typescript');
const { PrismaClient } = localRequire('@prisma/client');
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Coordinator must provide TEST_DATABASE_URL');
const parsed = new URL(url);
if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1' || !parsed.pathname.startsWith('/gamenight_')) throw new Error('Dedicated local gamenight_* database only');
const db = new PrismaClient({ datasourceUrl: url });
const suffix = String(Date.now());
const discordId = '8' + suffix;
const guildId = '7' + suffix;
let config;
let community;
let snapshot = 0;
let initialReads = 0;
let transactions = 0;
let releaseBothReads;
let releaseFirstCommit;
const bothReads = new Promise(resolve => { releaseBothReads = resolve; });
const firstCommit = new Promise(resolve => { releaseFirstCommit = resolve; });
const errors = [];
const prisma = { $transaction: async callback => {
  const request = ++transactions;
  const result = await db.$transaction(async tx => {
    const user = new Proxy(tx.user, { get(target, key) {
      if (key !== 'findUnique') {
        const value = Reflect.get(target, key);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return async args => {
        const found = await target.findUnique(args);
        assert.equal(found, null, 'Both requests must read an initially absent user');
        initialReads++;
        if (initialReads === 2) releaseBothReads();
        await bothReads;
        if (request === 2) await firstCommit;
        return found;
      };
    } });
    const proxy = new Proxy(tx, { get(target, key) { if (key === 'user') return user; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
    return callback(proxy);
  }, { timeout: 15000 });
  if (request === 1) releaseFirstCommit();
  return result;
} };
const stubs = {
  'next-auth': { default: c => { config = c; return {}; }, __esModule: true },
  'next-auth/providers/discord': { default: c => c, __esModule: true },
  '@/lib/prisma': { prisma }, '@/lib/discord-token-crypto': {},
  '@/lib/default-community': { ensureDefaultCommunityRecord: async () => ({}) },
  '@/lib/discord-user-guilds': { listOAuthUserGuildIds: async () => ++snapshot === 1 ? [guildId] : [] },
  '@/lib/logger': { logger: { warn() {}, error(error) { errors.push(error); } } },
};
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', source)(name => name in stubs ? stubs[name] : name.startsWith('@/') ? load('src/' + name.slice(2) + '.ts') : localRequire(name), module, module.exports);
  cache.set(file, module.exports);
  return module.exports;
}
(async () => {
  try {
    process.env.ADMIN_DISCORD_IDS = '';
    community = await db.community.create({ data: { slug: 'review-auth309-race-' + suffix, name: 'Review race', status: 'ACTIVE', discordGuildId: guildId } });
    load('src/auth.ts');
    const call = () => config.callbacks.signIn({ user: { id: discordId, name: 'Review race' }, profile: { id: discordId, username: 'Review race' }, account: { access_token: 'fake', scope: 'guilds' } });
    const results = await Promise.all([call(), call()]);
    assert.deepEqual(results, [true, false]);
    assert.equal(errors.length, 0);
    const user = await db.user.findUniqueOrThrow({ where: { discordId } });
    const membership = await db.membership.findUniqueOrThrow({ where: { communityId_userId: { userId: user.id, communityId: community.id } } });
    console.log(JSON.stringify({ results, initialReads, membershipStatusAfterNewerEmptySnapshot: membership.status }));
    assert.equal(membership.status, 'LEFT', 'Newer complete empty snapshot must persist departure for concurrently created user');
  } finally {
    await db.user.deleteMany({ where: { discordId } });
    if (community) await db.community.delete({ where: { id: community.id } });
    await db.$disconnect();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
