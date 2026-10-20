// Recette locale du rendu du bracket par équipes, sans appel Discord.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, openSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const database = new URL(process.env.TEST_DATABASE_URL ?? "");
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port, "55441");
assert.equal(database.pathname, "/gamenight_bracket_recipe");
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, "playwright-core existant requis");
assert.ok(!process.env.DOCKER_HOST, "DOCKER_HOST distant interdit");
const container = "gamenight-bracket-recipe-pg";
const containerAddresses = execFileSync("docker", ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", container], { encoding: "utf8" }).trim().split(/\s+/).filter(Boolean);
assert.ok(containerAddresses.length > 0, "Conteneur PostgreSQL local dédié introuvable");
assert.deepEqual(execFileSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).trim().split(/\s+/), ["127.0.0.1:55441"]);
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const db = new PrismaClient({ datasourceUrl: database.href });
const origin = "http://127.0.0.1:3103";
const secret = randomUUID();
const run = `bracket-${randomUUID()}`;
let browser;
let server;

try {
  const [target] = await db.$queryRaw`SELECT current_database() AS name, inet_server_addr()::text AS address, inet_server_port() AS port`;
  assert.equal(target.name, "gamenight_bracket_recipe");
  assert.equal(target.port, 5432);
  assert.ok(containerAddresses.includes(target.address), "La base ne correspond pas à l'adresse du conteneur PostgreSQL local dédié");
  await assert.rejects(fetch(origin), "Port 3103 déjà occupé");

  const community = await db.community.create({ data: { slug: run, name: run, status: "ACTIVE" } });
  const users = [];
  for (const name of ["Alice", "Bob", "Chloé", "David"]) {
    const user = await db.user.create({ data: { discordId: `${run}-${users.length}`, discordName: name, onboardingCompleted: true, activeCommunityId: community.id } });
    await db.membership.create({ data: { userId: user.id, communityId: community.id } });
    users.push(user);
  }
  const outsider = await db.user.create({ data: { discordId: `${run}-outsider`, discordName: "Tiers", onboardingCompleted: true } });
  const game = await db.game.create({ data: { name: `Jeu ${run}`, source: "MANUAL", addedById: users[0].id } });
  const tournament = await db.tournament.create({ data: {
    name: `Tournoi ${run}`, gameId: game.id, createdById: users[0].id,
    communityId: community.id, format: "TEAMS", status: "IN_PROGRESS", maxPlayers: 4,
  } });
  await db.tournamentParticipant.createMany({ data: users.map((user, index) => ({ tournamentId: tournament.id, userId: user.id, seed: index + 1 })) });
  const teams = [];
  for (const [position, members] of [[users[0], users[1]], [users[2], users[3]]].entries()) {
    const team = await db.tournamentTeam.create({ data: { tournamentId: tournament.id, name: `Équipe ${position + 1}`, position: position + 1 } });
    await db.tournamentTeamMember.createMany({ data: members.map((user) => ({ tournamentId: tournament.id, teamId: team.id, userId: user.id })) });
    teams.push(team);
  }
  const match = await db.tournamentMatch.create({ data: { tournamentId: tournament.id, round: 1, position: 0, team1Id: teams[0].id, team2Id: teams[1].id } });

  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (/ENABLED|TOKEN|SECRET|KEY|DATABASE_URL|DISCORD/.test(key)) delete childEnv[key];
  Object.assign(childEnv, {
    NODE_ENV: "development", TEST_DATABASE_URL: database.href, DATABASE_URL: database.href,
    AUTH_SECRET: secret, AUTH_URL: origin, NEXTAUTH_URL: origin,
    COMMUNITY_ISOLATION_ENABLED: "true", NEXT_TELEMETRY_DISABLED: "1",
  });
  mkdirSync("logs", { recursive: true });
  const log = openSync("logs/recette-bracket-equipes-next.log", "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3103"], { env: childEnv, stdio: ["ignore", log, log], windowsHide: true });
  const deadline = Date.now() + 120_000;
  while (true) {
    try { if ((await fetch(`${origin}/api/auth/session`)).ok) break; } catch { /* démarrage local */ }
    assert.ok(Date.now() < deadline && server.exitCode === null, "Next local indisponible; voir logs/recette-bracket-equipes-next.log");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  browser = await chromium.launch({ channel: "msedge", headless: true });
  const pageErrors = [];
  async function pageFor(user) {
    const context = await browser.newContext();
    await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const name = "authjs.session-token";
    const value = await encode({ secret, salt: name, maxAge: 3600, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } });
    await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(120_000);
    return page;
  }
  const creator = await pageFor(users[0]);
  const member = await pageFor(users[2]);
  const denied = await pageFor(outsider);
  const path = `/tournois/${tournament.id}`;
  await creator.goto(`${origin}${path}`);
  await creator.getByRole("heading", { name: `🏆 Tournoi ${run}` }).waitFor();
  await creator.getByText("Équipe 1 · Alice + Bob", { exact: true }).waitFor();
  await creator.getByText("Équipe 2 · Chloé + David", { exact: true }).waitFor();
  assert.equal(await creator.getByRole("button", { name: /Équipe 1.*gagne/ }).count(), 1);
  await member.goto(`${origin}${path}`);
  assert.equal(await member.getByRole("button", { name: /Équipe 2.*gagne/ }).count(), 1);
  await denied.goto(`${origin}${path}`);
  await denied.getByRole("heading", { name: /^404/ }).waitFor();
  await creator.setViewportSize({ width: 390, height: 844 });
  assert.ok(await creator.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "Débordement horizontal mobile");

  await db.$transaction([
    db.tournamentMatch.update({ where: { id: match.id }, data: { winnerTeamId: teams[0].id, completedAt: new Date() } }),
    db.tournament.update({ where: { id: tournament.id }, data: { status: "DONE", championTeamId: teams[0].id } }),
  ]);
  await creator.reload();
  await creator.getByText("Équipe 1 remporte le tournoi !").waitFor();
  assert.equal(await creator.getByRole("button", { name: /gagne/ }).count(), 0);
  assert.equal((await db.tournamentTeamMember.count({ where: { tournamentId: tournament.id } })), 4);
  assert.deepEqual(pageErrors, []);
  console.log(`OK bracket équipes : membres, accès tiers refusé, mobile, champion persistant. Fixture conservée : ${run}`);
} finally {
  await browser?.close();
  server?.kill();
  await db.$disconnect();
}
