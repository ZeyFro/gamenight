// Vrai navigateur/Next/PostgreSQL; seul le transport Blob est simulé sur loopback.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { assertLocalDockerContext } from "./recette-local-docker.mjs";
import { recetteDatabaseTarget } from "./recette-database-target.mjs";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { encode } from "next-auth/jwt";

const database = new URL(process.env.TEST_DATABASE_URL ?? "");
const recipeTarget = recetteDatabaseTarget();
assert.notEqual(process.env.NODE_ENV, "production");
assert.equal(database.protocol, "postgresql:");
assert.equal(database.hostname, "127.0.0.1");
assert.equal(database.port || "5432", recipeTarget.port);
assert.equal(database.pathname, `/${recipeTarget.database}`);
assert.ok(!process.env.DOCKER_HOST, "DOCKER_HOST distant interdit");
for (const file of [".env", ".env.local", ".env.development", ".env.development.local"]) assert.ok(!existsSync(file), `Environnement interdit : ${file}`);
assertLocalDockerContext();
const container = recipeTarget.container;
assert.equal(execFileSync("docker", ["port", container, "5432/tcp"], { encoding: "utf8" }).trim(), `127.0.0.1:${recipeTarget.port}`);
const addresses = execFileSync("docker", ["inspect", "--format", "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}", container], { encoding: "utf8" }).trim().split(/\s+/);
assert.ok(process.env.PLAYWRIGHT_MODULE_PATH, "playwright-core hors dépendances app requis");
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE_PATH);
const db = new PrismaClient({ datasourceUrl: database.href });
const origin = "http://127.0.0.1:3117";
const run = `medias-${randomUUID()}`;
const output = resolve("logs", run);
const secret = randomUUID();
const blobs = new Map();
const operations = [];
let browser, server, mock;
try {
  const [target] = await db.$queryRaw`SELECT current_database() AS name, inet_server_addr()::text AS address, inet_server_port() AS port`;
  assert.equal(target.name, recipeTarget.database);
  assert.equal(target.port, 5432);
  assert.ok(addresses.includes(target.address.split("/")[0]), "Cible différente du conteneur dédié");
  await assert.rejects(fetch(origin), "Port Next déjà occupé");
  mkdirSync(output, { recursive: true });
  mock = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1:3118");
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      if (request.method === "PUT") {
        const pathname = url.searchParams.get("pathname");
        assert.ok(pathname?.startsWith("sessions/"));
        blobs.set(pathname, body);
        operations.push({ method: "PUT", pathname, bytes: body.length });
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ pathname, url: `https://fixture.private.blob.vercel-storage.com/${pathname}`, downloadUrl: `https://fixture.private.blob.vercel-storage.com/${pathname}?download=1` }));
      } else if (request.method === "POST" && url.pathname === "/delete") {
        for (const pathname of JSON.parse(body).urls) { assert.ok(blobs.delete(pathname)); operations.push({ method: "DELETE", pathname }); }
        response.setHeader("content-type", "application/json");
        response.end("{}");
      } else if (request.method === "GET") {
        const pathname = decodeURIComponent(url.pathname.slice(1));
        operations.push({ method: "GET", pathname });
        const content = blobs.get(pathname);
        response.statusCode = content ? 200 : 404;
        if (content) response.setHeader("content-length", content.length);
        response.end(content);
      } else { response.statusCode = 400; response.end(); }
    } catch (error) { response.statusCode = 500; response.end(error.message); }
  });
  await new Promise((resolve, reject) => { mock.once("error", reject); mock.listen(3118, "127.0.0.1", resolve); });
  const community = await db.community.create({ data: { slug: run, name: run, status: "ACTIVE", sessionGalleryEnabled: true } });
  const users = [];
  for (const label of ["Créateur", "Invité", "Tiers"]) {
    const user = await db.user.create({ data: { discordId: `${run}-${users.length}`, discordName: label, onboardingCompleted: true, activeCommunityId: community.id } });
    await db.membership.create({ data: { userId: user.id, communityId: community.id } });
    users.push(user);
  }
  const session = await db.session.create({ data: { communityId: community.id, createdById: users[0].id, status: "DONE", date: new Date(), superlativeVotingClosed: true } });
  await db.sessionInvite.create({ data: { sessionId: session.id, userId: users[1].id, invitedById: users[0].id } });
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) if (/ENABLED|TOKEN|SECRET|KEY|DATABASE_URL|DISCORD|VERCEL|NODE_OPTIONS/.test(key)) delete childEnv[key];
  Object.assign(childEnv, {
    NODE_ENV: "development", TEST_DATABASE_URL: database.href, DATABASE_URL: database.href,
    AUTH_SECRET: secret, AUTH_URL: origin, NEXTAUTH_URL: origin, NEXT_TELEMETRY_DISABLED: "1",
    COMMUNITY_ISOLATION_ENABLED: "true", SESSION_VIDEO_ENABLED: "true",
    SESSION_MEDIA_BLOB_TOKEN: "vercel_blob_rw_fixture_local-recipe-only", GAMENIGHT_RECIPE_BLOB_ORIGIN: "http://127.0.0.1:3118", VERCEL_BLOB_API_URL: "http://127.0.0.1:3118",
    NODE_OPTIONS: `--import=${pathToFileURL(resolve("scripts/recette-medias-transport.mjs")).href}`,
  });
  const log = openSync(resolve(output, "next.log"), "w");
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3117"], { env: childEnv, stdio: ["ignore", log, log], windowsHide: true });
  const deadline = Date.now() + 180_000;
  while (true) {
    try { if ((await fetch(`${origin}/api/auth/session`)).ok) break; } catch { /* démarrage Next local */ }
    assert.ok(Date.now() < deadline && server.exitCode === null, `Next indisponible : ${output}/next.log`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  browser = await chromium.launch({ channel: "msedge", headless: true });
  const errors = [];
  async function pageFor(user) {
    const context = await browser.newContext();
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const name = "authjs.session-token";
    const value = await encode({ secret, salt: name, maxAge: 3600, token: { discordId: user.discordId, sessionCreatedAt: Date.now() } });
    await context.addCookies([{ name, value, url: origin, httpOnly: true, sameSite: "Lax" }]);
    await context.addInitScript(id => sessionStorage.setItem(`gn:onboarding-prompt:${id}`, "later"), user.id);
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    page.setDefaultNavigationTimeout(180_000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("requestfailed", request => console.error(`Requête échouée ${request.method()} ${request.url()}: ${request.failure()?.errorText}`));
    page.on("console", message => { if (message.type() === "error") console.error(message.text()); });
    return page;
  }
  async function waitFor(read, message) {
    const limit = Date.now() + 30_000;
    while (Date.now() < limit) { const value = await read(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 250)); }
    assert.fail(message);
  }
  const creator = await pageFor(users[0]);
  const guest = await pageFor(users[1]);
  const outsider = await pageFor(users[2]);
  await creator.goto(`${origin}/sessions/${session.id}`);
  await creator.getByRole("heading", { name: "📸 Galerie de la soirée" }).waitFor();
  await creator.waitForLoadState("networkidle");
  const png = await creator.getByRole("heading", { name: "📸 Galerie de la soirée" }).screenshot({ caret: "initial" });
  writeFileSync(resolve(output, "capture-locale.png"), png);
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=purple:s=160x120:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", resolve(output, "clip-local.mp4")], { windowsHide: true });
  const mp4 = readFileSync(resolve(output, "clip-local.mp4"));
  for (const [name, mimeType, buffer] of [["capture-locale.png", "image/png", png], ["clip-local.mp4", "video/mp4", mp4]]) {
    await creator.getByLabel("Ajouter un média", { exact: true }).setInputFiles({ name, mimeType, buffer });
    await creator.getByRole("checkbox").check();
    console.log(`Envoi local : ${name}`);
    console.log(await creator.locator('input[name="media"]').evaluate(element => ({ files: element.files.length, consent: element.form.querySelector('[name="consent"]').checked, valid: element.form.checkValidity(), action: element.form.getAttribute("action") })));
    await creator.getByRole("button", { name: "Partager dans la galerie" }).click();
    // Le statut d'un envoi précédent peut rester affiché : seule la ligne en base prouve l'envoi courant.
    const row = await waitFor(() => db.sessionGalleryMedia.findFirst({ where: { sessionId: session.id, mimeType } }), `média ${mimeType} absent de la base`);
    await creator.waitForURL(/gallery=ok/);
    await creator.waitForLoadState("networkidle");
    assert.equal(row.sizeBytes, buffer.length);
    assert.deepEqual(blobs.get(row.pathname), buffer);
  }
  assert.equal(await db.sessionGalleryMedia.count({ where: { sessionId: session.id } }), 2);
  await guest.goto(`${origin}/sessions/${session.id}`);
  const image = guest.getByAltText("Photo partagée dans la galerie de la soirée");
  await image.scrollIntoViewIfNeeded();
  await guest.waitForFunction(() => [...document.images].some(image => image.alt === "Photo partagée dans la galerie de la soirée" && image.complete && image.naturalWidth > 0));
  const video = guest.locator("video");
  await video.scrollIntoViewIfNeeded();
  await video.evaluate(element => element.load());
  await guest.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
  assert.equal(await video.evaluate(element => element.error?.message ?? null), null);
  assert.ok(await video.evaluate(element => element.duration > 0));
  await video.evaluate(element => element.play());
  await guest.waitForFunction(() => document.querySelector("video")?.currentTime > 0);
  await video.evaluate(element => element.pause());
  assert.equal(await guest.locator("figure").getByRole("button", { name: "Supprimer", exact: true }).count(), 0);
  const media = await db.sessionGalleryMedia.findMany({ where: { sessionId: session.id } });
  const clip = media.find(item => item.mimeType === "video/mp4");
  const path = `${origin}/api/sessions/${session.id}/media/${clip.id}`;
  const range = await guest.request.get(path, { headers: { Range: "bytes=0-15" } });
  assert.equal(range.status(), 206);
  assert.equal(range.headers()["content-range"], `bytes 0-15/${mp4.length}`);
  assert.equal(range.headers()["cache-control"], "private, no-store");
  assert.deepEqual(await range.body(), mp4.subarray(0, 16));
  const invalidRange = await guest.request.get(path, { headers: { Range: `bytes=${mp4.length}-` } });
  assert.equal(invalidRange.status(), 416);
  for (const item of media) assert.equal((await outsider.request.get(`${origin}/api/sessions/${session.id}/media/${item.id}`)).status(), 404);
  await guest.setViewportSize({ width: 390, height: 844 });
  assert.ok(await guest.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Débordement galerie mobile");
  await guest.screenshot({ path: resolve(output, "galerie-mobile.png"), fullPage: true });
  await db.sessionInvite.update({ where: { sessionId_userId: { sessionId: session.id, userId: users[1].id } }, data: { status: "REVOKED" } });
  assert.equal((await guest.request.get(path)).status(), 404);
  await creator.screenshot({ path: resolve(output, "galerie-createur.png"), fullPage: true });
  await creator.locator("figure").getByRole("button", { name: "Supprimer", exact: true }).first().click();
  await waitFor(async () => await db.sessionGalleryMedia.count({ where: { sessionId: session.id } }) === 1, "suppression absente de la base");
  assert.equal(blobs.size, 1);
  assert.equal(operations.filter(operation => operation.method === "PUT").length, 2);
  assert.equal(operations.filter(operation => operation.method === "DELETE").length, 1);
  assert.equal(await db.notificationDelivery.count({ where: { event: { sourceId: session.id } } }), 0);
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "preuve.json"), JSON.stringify({ run, sessionId: session.id, transport: "Blob simulé en mémoire sur 127.0.0.1:3118", operations, checks: ["upload PNG et MP4 octets identiques", "image décodée", "vidéo H264 lue", "Range206 + invalide416", "tiers404", "révocation404", "mobile390x844", "suppression DB+Blob", "aucune NotificationDelivery", "aucune pageerror"] }, null, 2));
  console.log(`OK médias réels avec transport Blob simulé; preuves ${output}; fixtures conservées ${run}`);
} catch (error) {
  console.error(error.stack);
  console.error(JSON.stringify({ operations }));
  if (browser) for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error(`Page locale ${page.url()}: ${(await page.locator("body").innerText()).slice(-3500)}`);
  }
  process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(server.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else server.kill();
  }
  await new Promise(resolve => mock ? mock.close(resolve) : resolve());
  await db.$disconnect();
}
