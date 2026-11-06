import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDockerContext, localDockerArgs } from "./recette-local-docker.mjs";
import { recetteDatabaseTarget } from "./recette-database-target.mjs";
import { createRecipeSafeDispatcher } from "./recette-medias-dispatcher.mjs";
import { disableExistingSuperlativeCategories, restoreRecipeSuperlativeCategories } from "./recette-superlative-category-state.mjs";

const expectedArgs = ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"];
const mockPort = "61234";
function fakeDocker(output) {
  return (command, args, options) => {
    assert.equal(command, "docker");
    assert.deepEqual(args, expectedArgs);
    assert.deepEqual(options, { encoding: "utf8" });
    return output;
  };
}

for (const endpoint of ["npipe:////./pipe/docker_engine", "unix:///var/run/docker.sock"]) {
  assert.equal(assertLocalDockerContext(fakeDocker(`${endpoint}\n`), {}), endpoint);
  assert.deepEqual(localDockerArgs(endpoint, ["port", "gamenight-test-pg", "5432/tcp"]), ["--host", endpoint, "port", "gamenight-test-pg", "5432/tcp"]);
}
assert.throws(() => localDockerArgs("tcp://docker.example:2376", ["port"]), /Docker local requis/);
for (const endpoint of ["ssh://docker.example", "tcp://127.0.0.1:2375", "npipe:////server/pipe/docker_engine", ""]) {
  assert.throws(() => assertLocalDockerContext(fakeDocker(`${endpoint}\n`), {}), /Docker local requis/);
}
let dockerCalled = false;
assert.throws(() => assertLocalDockerContext(() => { dockerCalled = true; return "npipe:////./pipe/docker_engine"; }, { DOCKER_HOST: "tcp://docker.example:2376" }), /DOCKER_HOST non vide interdit/);
assert.equal(dockerCalled, false, "DOCKER_HOST doit être refusé avant toute commande Docker");
assert.equal(assertLocalDockerContext(fakeDocker("npipe:////./pipe/docker_engine\n"), { DOCKER_HOST: "" }), "npipe:////./pipe/docker_engine");
const explicitTarget = {
  GAMENIGHT_RECIPE_PG_CONTAINER: "gamenight-recipe-fresh",
  GAMENIGHT_RECIPE_PG_PORT: mockPort,
  GAMENIGHT_RECIPE_PG_DATABASE: "gamenight_recipe_fresh",
};
assert.deepEqual(recetteDatabaseTarget(explicitTarget), { container: "gamenight-recipe-fresh", port: mockPort, database: "gamenight_recipe_fresh" });
for (const name of Object.keys(explicitTarget)) {
  const missingTarget = { ...explicitTarget };
  delete missingTarget[name];
  assert.throws(() => recetteDatabaseTarget(missingTarget), new RegExp(`Missing recipe PostgreSQL target variable: ${name}`));
}
assert.throws(() => recetteDatabaseTarget({}), /Missing recipe PostgreSQL target variable: GAMENIGHT_RECIPE_PG_CONTAINER/);
assert.throws(() => recetteDatabaseTarget({ ...explicitTarget, GAMENIGHT_RECIPE_PG_PORT: `${mockPort};drop` }), /Invalid recipe PostgreSQL port/);
assert.throws(() => recetteDatabaseTarget({ ...explicitTarget, GAMENIGHT_RECIPE_PG_DATABASE: "production;drop" }), /Invalid recipe PostgreSQL database/);

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const xpTemporaryDirectory = mkdtempSync(join(tmpdir(), "gamenight-xp-docker-guard-"));
try {
  const baseline = join(xpTemporaryDirectory, "schema.prisma");
  writeFileSync(baseline, "// pre-XP migration baseline\n");
  const result = spawnSync(process.execPath, [join(root, "scripts/recette-xp-migration.mjs"), baseline], {
    cwd: root,
    env: { ...process.env, DOCKER_HOST: "tcp://127.0.0.1:1" },
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /DOCKER_HOST non vide interdit/);
} finally {
  rmSync(xpTemporaryDirectory, { recursive: true, force: true });
}

let forwarded = false;
let externalError;
const safeDispatcher = createRecipeSafeDispatcher({
  dispatch() { forwarded = true; throw new Error("external request reached transport"); },
  close() {},
  destroy() {},
}, "http://127.0.0.1:3118");
assert.equal(safeDispatcher.dispatch({ origin: "https://outside.example", path: "/" }, { onError(error) { externalError = error; } }), true);
await new Promise(resolve => setImmediate(resolve));
assert.equal(forwarded, false, "external request must not reach a network dispatcher");
assert.match(externalError?.message ?? "", /HTTP externe interdit \(outside\.example\)/);

const categories = new Map([
  ["initial-active", { id: "initial-active", active: true }],
  ["initial-inactive", { id: "initial-inactive", active: false }],
]);
const categoryCalls = [];
const fakeCategoryDb = { superlativeCategory: {
  async findMany(query) {
    assert.deepEqual(query, { select: { id: true, active: true } });
    return [...categories.values()].map(category => ({ ...category }));
  },
  async updateMany({ where, data }) {
    categoryCalls.push({ operation: "update", where, data });
    const ids = where.id.in ?? [where.id];
    for (const id of ids) if (categories.has(id)) Object.assign(categories.get(id), data);
    return { count: ids.length };
  },
  async deleteMany({ where }) {
    categoryCalls.push({ operation: "delete", where });
    return { count: Number(categories.delete(where.id)) };
  },
} };
const categoryState = {};
await disableExistingSuperlativeCategories(fakeCategoryDb, categoryState);
assert.deepEqual(categoryState.originals, [
  { id: "initial-active", active: true },
  { id: "initial-inactive", active: false },
]);
assert.equal(categories.get("initial-active").active, false);
assert.equal(categories.get("initial-inactive").active, false);
categories.set("unrelated-later", { id: "unrelated-later", active: true });
categories.set("recipe-category", { id: "recipe-category", active: true });
categoryState.recipeCategoryId = "recipe-category";
await restoreRecipeSuperlativeCategories(fakeCategoryDb, categoryState);
assert.equal(categories.get("initial-active").active, true);
assert.equal(categories.get("initial-inactive").active, false);
assert.equal(categories.get("unrelated-later").active, true);
assert.equal(categories.has("recipe-category"), false);
assert.deepEqual(categoryCalls[0], { operation: "update", where: { id: { in: ["initial-active", "initial-inactive"] } }, data: { active: false } });
assert.ok(categoryCalls.filter(call => call.operation === "update").every(call => call.where.id !== undefined), "category changes must target saved IDs only");

const partialState = {};
await disableExistingSuperlativeCategories(fakeCategoryDb, partialState);
await restoreRecipeSuperlativeCategories(fakeCategoryDb, partialState);
assert.equal(categories.get("initial-active").active, true, "partial setup without a created category must restore initial state");
assert.equal(categories.has("unrelated-later"), true);

if (process.platform === "win32") {
  const temporaryDirectory = mkdtempSync(join(tmpdir(), "gamenight-docker-guard-"));
  const dockerLog = join(temporaryDirectory, "docker.log");
  writeFileSync(join(temporaryDirectory, "docker.cmd"), [
    "@echo off",
    'echo %*>>"%DOCKER_LOG%"',
    'if "%1"=="context" (',
    "  echo npipe:////server/pipe/docker_engine",
    "  exit /b 0",
    ")",
    "exit /b 0",
    "",
  ].join("\r\n"));
  const env = { ...process.env, PATH: `${temporaryDirectory};${process.env.PATH}`, DOCKER_LOG: dockerLog };
  delete env.DOCKER_HOST;
  delete env.GAMENIGHT_RECIPE_PG_CONTAINER;
  delete env.GAMENIGHT_RECIPE_PG_PORT;
  delete env.GAMENIGHT_RECIPE_PG_DATABASE;
  try {
    const missingTargetResult = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/recette-medias.ps1")], { env, encoding: "utf8" });
    assert.notEqual(missingTargetResult.status, 0, "PowerShell wrapper must reject a missing target");
    assert.equal(existsSync(dockerLog), false, "wrapper must reject a missing target before any Docker command");

    const remoteEnv = {
      ...env,
      GAMENIGHT_RECIPE_PG_CONTAINER: "gamenight-recipe-fresh",
      GAMENIGHT_RECIPE_PG_PORT: mockPort,
      GAMENIGHT_RECIPE_PG_DATABASE: "gamenight_recipe_fresh",
    };
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/recette-medias.ps1")], { env: remoteEnv, encoding: "utf8" });
    assert.notEqual(result.status, 0, "PowerShell wrapper must reject a remote Docker context");
    assert.equal(readFileSync(dockerLog, "utf8").trim(), "context inspect --format {{.Endpoints.docker.Host}}", "wrapper must reject before any Docker inspection");

    writeFileSync(dockerLog, "");
    writeFileSync(join(temporaryDirectory, "docker.cmd"), [
      "@echo off",
      'echo %*>>"%DOCKER_LOG%"',
      'if "%1"=="context" (',
      "  echo npipe:////./pipe/docker_engine",
      "  exit /b 0",
      ")",
      'if "%1"=="inspect" (',
      "  echo POSTGRES_PASSWORD=recipe:p@ss",
      "  exit /b 0",
      ")",
      "exit /b 0",
      "",
    ].join("\r\n"));
    const targetResult = join(temporaryDirectory, "target.txt");
    const probeScript = join(temporaryDirectory, "target.mjs");
    writeFileSync(probeScript, 'import { writeFileSync } from "node:fs"; writeFileSync(process.env.RECIPE_TARGET_RESULT, process.env.TEST_DATABASE_URL);\n');
    const targetEnv = {
      ...env,
      GAMENIGHT_RECIPE_PG_CONTAINER: "gamenight-recipe-fresh",
      GAMENIGHT_RECIPE_PG_PORT: mockPort,
      GAMENIGHT_RECIPE_PG_DATABASE: "gamenight_recipe_fresh",
      GAMENIGHT_PLAYWRIGHT_MODULE_PATH: temporaryDirectory,
      RECIPE_TARGET_RESULT: targetResult,
    };
    const targetRun = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/recette-medias.ps1"), "-Script", probeScript], { env: targetEnv, encoding: "utf8" });
    assert.equal(targetRun.status, 0, targetRun.stderr || targetRun.stdout);
    assert.equal(readFileSync(targetResult, "utf8"), `postgresql://postgres:recipe%3Ap%40ss@127.0.0.1:${mockPort}/gamenight_recipe_fresh`);
    assert.deepEqual(readFileSync(dockerLog, "utf8").trim().split(/\r?\n/), [
      "context inspect --format {{.Endpoints.docker.Host}}",
      'inspect --format "{{range .Config.Env}}{{println .}}{{end}}" gamenight-recipe-fresh',
    ]);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
console.log("OK local Docker guards, no-network external request rejection, and scoped category restoration");
