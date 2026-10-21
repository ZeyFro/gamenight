import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDockerContext } from "./recette-local-docker.mjs";
import { createRecipeSafeDispatcher } from "./recette-medias-dispatcher.mjs";
import { disableExistingSuperlativeCategories, restoreRecipeSuperlativeCategories } from "./recette-superlative-category-state.mjs";

const expectedArgs = ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"];
function fakeDocker(output) {
  return (command, args, options) => {
    assert.equal(command, "docker");
    assert.deepEqual(args, expectedArgs);
    assert.deepEqual(options, { encoding: "utf8" });
    return output;
  };
}

for (const endpoint of ["npipe:////./pipe/docker_engine", "unix:///var/run/docker.sock"]) {
  assert.doesNotThrow(() => assertLocalDockerContext(fakeDocker(`${endpoint}\n`)));
}
for (const endpoint of ["ssh://docker.example", "tcp://127.0.0.1:2375", "npipe:////server/pipe/docker_engine", ""]) {
  assert.throws(() => assertLocalDockerContext(fakeDocker(`${endpoint}\n`)), /Docker local requis/);
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
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
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
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-File", join(root, "scripts/recette-medias.ps1")], { env, encoding: "utf8" });
    assert.notEqual(result.status, 0, "PowerShell wrapper must reject a remote Docker context");
    assert.equal(readFileSync(dockerLog, "utf8").trim(), "context inspect --format {{.Endpoints.docker.Host}}", "wrapper must reject before any Docker inspection");
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
console.log("OK local Docker guards, no-network external request rejection, and scoped category restoration");
