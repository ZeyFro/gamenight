import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

function assertLocalDockerHost(endpoint) {
  assert.ok(endpoint.startsWith("npipe:////./pipe/") || endpoint.startsWith("unix://"), "Docker local requis");
  return endpoint;
}

export function assertLocalDockerContext(run = execFileSync, env = process.env) {
  assert.ok(!env.DOCKER_HOST, "DOCKER_HOST non vide interdit");
  const endpoint = run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
  return assertLocalDockerHost(endpoint);
}

export function localDockerArgs(endpoint, args) {
  return ["--host", assertLocalDockerHost(endpoint), ...args];
}
