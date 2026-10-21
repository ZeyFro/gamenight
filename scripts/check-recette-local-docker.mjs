import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertLocalDockerContext } from "./recette-local-docker.mjs";

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
console.log("OK local Docker contexts are accepted; remote and empty contexts are rejected");
