/** Mutations ciblées, en série, uniquement sur Postgres local. Ne pas lancer avec une autre suite. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

assert(process.env.TEST_DATABASE_URL && new URL(process.env.TEST_DATABASE_URL).hostname === "127.0.0.1", "TEST_DATABASE_URL 127.0.0.1 obligatoire");
assert(!process.env.DISCORD_WEBHOOK_URL && !process.env.DISCORD_BOT_TOKEN, "Aucun secret Discord dans ce runner");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gamenight-prb-mutations-"));
const lib = (name) => `src/lib/${name}.ts`;
const test = (name) => lib(`${name}.test`);
const integration = (name) => lib(`${name}.integration.test`);
const scopeFile = lib("community-scoped-client");
const core = integration("community-progression");
const views = integration("community-progress-views");
const admin = integration("community-admin-retention");
const edits = (file, before, after) => ({ file, before, after });
const bypassModel = (model) => edits(scopeFile, "if (scope === null || !COMMUNITY_SCOPED_MODELS.has(model)) return args;", `if (model === "${model}" || scope === null || !COMMUNITY_SCOPED_MODELS.has(model)) return args;`);
const cases = [];
const add = (name, file, pattern, changes) => cases.push({ name, file, pattern, changes });
for (const model of ["CommunityMemberStats", "XpEvent", "LevelUpEvent", "UserBadge", "SessionResult", "Notification", "NotificationEvent", "ChatMessage", "Debt"])
  add(`transaction-${model}`, test("community-scoped-client"), `${model} : lecture et mutation`, [bypassModel(model)]);
add("membership-writer", core, "membre absent ou révoqué", [edits(lib("member-stats"), 'return members[0]?.status === "ACTIVE";', "return true;")]);
add("suspension-writer", core, "serveur suspendu", [edits(lib("member-stats"), 'if (communities[0].status !== "ACTIVE") return false;', "if (false) return false;")]);
add("membership-reader", views, "droits :", [edits(lib("member-stats"), 'if (!(await isMemberOfCommunity(userId, communityId))) return { ...ZERO_MEMBER_STATS };', "// mutation : pas de validation du membre")]);
add("xp-idempotence", core, "réessais simultanés", [edits(lib("xp-actions"), 'await scopedDb.xpEvent.create({ data: { communityId: id, userId, reason, sourceId, amount } });', 'await scopedDb.xpEvent.createMany({ data: { communityId: id, userId, reason, sourceId, amount }, skipDuplicates: true });')]);
add("xp-historical-replay", core, "replay live :", [edits(lib("xp-actions"), 'if (id !== defaultId && reason !== "BADGE_UNLOCKED" && await tx.user.findFirst({', 'if (false && id !== defaultId && reason !== "BADGE_UNLOCKED" && await tx.user.findFirst({')]);
add("xp-first-global", core, "premier geste global", [edits(lib("xp-actions"), 'if (reason === "STEAM_LINK_FIRST" || reason === "AVAILABILITY_FIRST") {', 'if (false) {')]);
add("backfill-first-global", core, "backfill Steam :", [edits(lib("backfill-xp"), 'if (reason === "STEAM_LINK_FIRST" || reason === "AVAILABILITY_FIRST") {', 'if (false) {')]);
const reward = integration("reward-notifications");
add("reward-intention", reward, "interruption après commit|échec du contrôle", [edits(lib("xp-actions"), 'await persistRewardNotice(tx, credit, rewardNotice);', '// mutation : crédit sans intention durable')]);
add("reward-legacy-silence", reward, "ancien crédit", [edits(lib("xp-actions"), 'if (created.count === 0) return { leveledUp:', 'if (false) return { leveledUp:')]);
add("reward-atomicity", reward, "panne de persistance", [edits(lib("xp-actions"), 'await persistRewardNotice(tx, credit, rewardNotice);', 'await persistRewardNotice(prisma as unknown as Prisma.TransactionClient, credit, rewardNotice);')]);
add("reward-retention-replay", reward, "notification purgée", [edits(lib("xp-actions"), 'if (created.count === 0) return { leveledUp:', 'if (created.count === 0 && !await scopedDb.notificationEvent.findUnique({ where: { id: `xp-reward:${credit.id}` } })) return { leveledUp:')]);
add("reward-immediate", reward, "flags OFF et executor OFF", [edits(lib("xp-actions"), 'if (result.rewardCreditId) await attemptDefaultRewardDelivery(result.rewardCreditId);', '// mutation : aucun chemin immédiat')]);
add("reward-targeted-claim", reward, "flags OFF et executor OFF", [edits(lib("notification-delivery"), 'AND (${opts.deliveryId ?? null}::text IS NULL OR id = ${opts.deliveryId ?? null})', '')]);
add("reward-transport", reward, "WEBHOOK en attente", [edits(lib("community-announce"), 'if (!isRewardWebhookConfigured()) return', 'if (botEnabled || !isRewardWebhookConfigured()) return')]);
add("reward-configuration-retry", reward, "WEBHOOK en attente", [edits(lib("notification-executor"), 'if (reason === "configuration_unavailable") {', 'if (false) {')]);
add("reward-configuration-budget", reward, "WEBHOOK en attente", [edits(lib("notification-delivery"), '...(input.refundAttempt ? { attempts: { decrement: 1 } } : {}),', '// mutation : les attentes épuisent les tentatives HTTP')]);
add("reward-admin-scope", reward, "admin REWARD", [edits(lib("reward-delivery-retry"), 'if (!row?.event.communityId || !(await lockCommunityProgress(tx, row.event.communityId, userId))) return false;', 'if (!row?.event.communityId) return false;')]);
add("reward-admin-selection", reward, "admin REWARD", [edits(lib("reward-delivery-retry"), 'id: deliveryId, status: "FAILED",\n      event: { category: "REWARD", eventType: "COMMUNITY_SYSTEM_ANNOUNCE", ...communityIdFilter(scope) },', 'id: deliveryId, status: "FAILED",\n      event: { category: "REWARD", eventType: "COMMUNITY_SYSTEM_ANNOUNCE" },')]);
add("friend-badge-membership", views, "badges d'un pote retiré", [edits("src/app/potes/[id]/badges/page.tsx", '!(await isMemberOfCommunity(user.id, communityId)) || !(await isMemberOfCommunity(id, communityId))', '!(await isMemberOfCommunity(user.id, communityId))')]);
add("delivery-timezone", integration("notification-delivery"), "fuseau", [edits(lib("notification-delivery"), '("nextAttemptAt" IS NULL OR "nextAttemptAt" <= (${now}::timestamptz AT TIME ZONE \'UTC\'))', '("nextAttemptAt" IS NULL OR "nextAttemptAt" <= ${now})')]);
add("badge-xp-filter", core, "badge participation", [bypassModel("XpEvent"), edits(lib("badges"), 'where: { communityId: id, userId, reason: "PARTICIPATE" }', 'where: { userId, reason: "PARTICIPATE" }')]);
add("badge-earned-filter", core, "même badge dans deux", [bypassModel("UserBadge"), edits(lib("badges"), 'where: { communityId: id, userId }, include: { badge: true }', 'where: { userId }, include: { badge: true }')]);
for (const [reason, criterion] of [["CREATE_SESSION", "SESSIONS_CREATED"], ["VOTE", "VOTES_CAST"], ["CHALLENGE_COMPLETE", "CHALLENGES_COMPLETED"], ["TOURNAMENT_RESULT", "TOURNAMENTS_WON"]]) {
  const tail = reason === "TOURNAMENT_RESULT" ? ', sourceId: { endsWith: ":1st" }' : '';
  add(`badge-${reason}`, core, `badge ledger ${criterion}`, [bypassModel("XpEvent"), edits(lib("badges"), `where: { communityId: id, userId, reason: "${reason}"${tail} }`, `where: { userId, reason: "${reason}"${tail} }`)]);
}
add("bet-balance-community", core, "mises : un gros solde", [edits(lib("xp-bets"), 'WHERE "communityId" = ${communityId} AND "userId" = ${voterId} FOR UPDATE', 'WHERE "userId" = ${voterId} ORDER BY "xpBalance" DESC FOR UPDATE')]);
for (const [model, criterion] of [["SuperlativeAward", "SUPERLATIVES_WON"], ["Pronostic", "PRONOSTICS_CORRECT"], ["XpBet", "BETS_WON"]]) {
  add(`badge-durable-${criterion}`, core, `badge durable ${criterion}`, [bypassModel(model), edits(lib("member-stats"), 'return { OR: [{ communityId }, ...(communityId === await getDefaultCommunityId() ? [{ communityId: null }] : [])] };', 'return { OR: [{}] };')]);
}
add("season-reset", views, "saison :", [bypassModel("CommunityMemberStats"), edits(lib("seasons"), 'updateMany({ where: { communityId }, data: { xpTotal: 0, xpBalance: 0 } })', 'updateMany({ where: {}, data: { xpTotal: 0, xpBalance: 0 } })')]);
add("season-active-champion", views, "saison :", [edits(lib("seasons"), 'return ranked.find((u) => u.memberships.length > 0) ?? null;', 'return ranked[0] ?? null;')]);
add("scoreboard-xp", views, "XP : retour flags OFF", [edits(lib("scoreboard"), 'const memberFilter = { communityId, userId:', 'const memberFilter = { userId:')]);
add("profile-result", views, "profil aperçu", [bypassModel("SessionResult")]);
add("profile-season", views, "historique de saisons", [edits("src/app/profil/saisons/page.tsx", 'season: { communityId: { in: communityId ? [communityId] : [] } }', 'season: {}')]);
add("feed-badges", views, "XP : retour flags OFF", [edits(lib("home"), 'scopedDb.userBadge.findMany({\n      where: { user: members, ...progressCommunity },', 'scopedDb.userBadge.findMany({\n      where: { user: members },')]);
add("feed-levels", views, "accueil : feed", [bypassModel("LevelUpEvent"), edits(lib("home"), 'scopedDb.levelUpEvent.findMany({\n      where: { user: members, ...progressCommunity },', 'scopedDb.levelUpEvent.findMany({\n      where: { user: members },')]);
add("feed-streak", views, "accueil : feed", [bypassModel("CommunityMemberStats"), edits(lib("home"), '        ...progressCommunity,\n        streakCount:', '        streakCount:')]);
add("retention-scope", admin, "rétention|purge notifications|livraisons techniques", [edits(lib("retention"), 'active.communityIds.filter((id) => scope.communityIds.includes(id))', 'active.communityIds')]);
add("retention-suspension-lock", admin, "suspension", [edits(lib("retention"), "WHERE status = 'ACTIVE'\n      AND id", "WHERE true\n      AND id")]);
for (const [parent, alias] of [["session", "s"], ["tournament", "t"]]) {
  const text = fs.readFileSync(lib("retention"), "utf8").replace(/\r\n/g, "\n");
  const marker = 'AND (${!isCommunityIsolationEnabled()} OR EXISTS (SELECT 1 FROM "Community" c';
  const start = text.indexOf(marker, text.indexOf(`SELECT ${alias}.id, ${alias}.status`));
  const end = text.indexOf(" FOR UPDATE", start);
  assert(start >= 0 && end > start, `Filtre SQL ${parent} introuvable`);
  add(`retention-sql-${parent}`, admin, `suspension.* ${parent} :`, [edits(lib("retention"), text.slice(start, end), "")]);
}
for (const [name, before, after] of [
  ["proposal", 'scopedDb.proposal.count({ where: { session: parentWhere } })', 'scopedDb.proposal.count({ where: {} })'],
  ["vote", 'proposal: { session: parentWhere }', 'proposal: { session: {} }'],
  ["match", 'tournament: parentWhere', 'tournament: {}'],
  ["snapshot", 'season: { communityId: progressionWhere.communityId }', 'season: {}'],
  ["delivery", 'const deliveryWhere = { event: parentWhere };', 'const deliveryWhere = {};'],
  ["terminal", 'event: { occurrence: { not: "" }, ...parentWhere }', 'event: { occurrence: { not: "" } }'],
]) add(`audit-${name}`, admin, "audit :|audit des livraisons", [edits(lib("storage-audit"), before, after)]);
add("admin-retry-event", admin, "admin réessai|inventaire legacy", [edits(lib("discord-cleanup-status"), 'event: communityIdFilter(scope),', 'event: {},')]);
add("legacy-event", admin, "inventaire legacy", [edits(lib("legacy-discord-announces"), 'event: communityIdFilter(scope),', 'event: {},')]);
add("technical-selection", admin, "livraisons techniques", [edits(lib("retention"), 'event: { occurrence: { not: "" }, ...communityIdFilter(scope) },', 'event: { occurrence: { not: "" } },')]);
add("technical-delete", admin, "suspension.*notificationDelivery", [edits(lib("retention"), 'event: { occurrence: { not: "" }, ...communityIdFilter(mutationScope) }', 'event: { occurrence: { not: "" } }')]);
add("provenance-parent", admin, "provenance event", [edits(lib("notification-delivery"), 'if (source) return source.communityId;', '// mutation : parent ignoré')]);
add("provenance-journal", admin, "provenance event", [edits(lib("notification-delivery"), 'if (previous) return previous.communityId;', '// mutation : journal ignoré')]);
add("notification-mark-read", admin, "notifications :", [bypassModel("Notification")]);
for (const [name, before, after] of [
  ["community", 'if (community?.status !== "ACTIVE") return { eligible: false, reason: "expired" };', 'if (!community) return { eligible: false, reason: "expired" };'],
  ["guild", 'community.slug !== DEFAULT_COMMUNITY_SLUG && destination.guildId !== community.discordGuildId', 'false'],
  ["recipient", 'return discordIds.every((id) => activeIds.has(id));', 'return true;'],
]) add(`announce-${name}`, test("community-announce"), "refuse|membre retiré", [edits(lib("community-announce"), before, after)]);
add("channel-off-fallback", test("community-channels"), undefined, [edits(lib("community-channels"), 'return community?.slug === DEFAULT_COMMUNITY_SLUG && community.status === "ACTIVE" ? legacy() : null;', 'return legacy();')]);
add("channel-missing-fallback", test("community-channels"), undefined, [edits(lib("community-channels"), 'if (!row) return isDefault ? legacy() : null;', 'if (!row) return legacy();')]);

const report = [];
const filter = process.argv[2];
for (const item of cases.filter((item) => !filter || new RegExp(filter).test(item.name))) {
  const originals = new Map();
  const outputFile = path.join(tmp, `${item.name}.json`);
  try {
    for (const change of item.changes) {
      if (!originals.has(change.file)) originals.set(change.file, fs.readFileSync(change.file));
      const original = fs.readFileSync(change.file, "utf8");
      const text = original.replace(/\r\n/g, "\n");
      assert(text.includes(change.before), `Mutation introuvable : ${item.name}`);
      assert.equal(text.split(change.before).length, 2, `Mutation ambiguë : ${item.name}`);
      const changed = text.replace(change.before, change.after);
      fs.writeFileSync(change.file, original.includes("\r\n") ? changed.replace(/\n/g, "\r\n") : changed);
    }
    const args = ["node_modules/vitest/vitest.mjs", "run", item.file, "--maxWorkers=1", "--reporter=json", `--outputFile=${outputFile}`];
    if (item.pattern) args.push("-t", item.pattern);
    const result = spawnSync(process.execPath, args, { encoding: "utf8", env: process.env, timeout: 90_000 });
    fs.writeFileSync(path.join(tmp, `${item.name}.log`), `${result.stdout ?? ""}\n${result.stderr ?? ""}`);
    const tests = fs.existsSync(outputFile) ? JSON.parse(fs.readFileSync(outputFile, "utf8")) : null;
    const assertions = tests?.testResults?.flatMap((file) => file.assertionResults ?? []) ?? [];
    const failures = assertions.filter((result) => result.status === "failed");
    // Une assertion échouée ou une erreur métier inattendue tue le mutant.
    // Les erreurs de compilation/import, sans test exécuté, ne le tuent pas.
    const status = result.status !== 0 && failures.length > 0 ? "KILLED" : "SURVIVED";
    report.push({ name: item.name, status, failures: failures.map((result) => result.fullName), skipped: assertions.filter((result) => result.status === "pending" || result.status === "skipped").length });
    console.log(`${item.name}: ${status}`);
  } catch (error) {
    report.push({ name: item.name, status: "ERROR", error: String(error) }); console.log(`${item.name}: ERROR ${error}`);
  } finally {
    for (const [file, original] of originals) {
      fs.writeFileSync(file, original);
      assert.equal(createHash("sha256").update(fs.readFileSync(file)).digest("hex"), createHash("sha256").update(original).digest("hex"));
    }
    fs.writeFileSync(path.join(tmp, "report.json"), JSON.stringify(report, null, 2));
  }
}
console.log(`Rapport : ${path.join(tmp, "report.json")}`);
if (report.some((item) => item.status !== "KILLED")) process.exitCode = 1;
