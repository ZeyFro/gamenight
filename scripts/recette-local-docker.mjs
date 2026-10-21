import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

export function assertLocalDockerContext(run = execFileSync) {
  const endpoint = run("docker", ["context", "inspect", "--format", "{{.Endpoints.docker.Host}}"], { encoding: "utf8" }).trim();
  assert.ok(endpoint.startsWith("npipe:////./pipe/") || endpoint.startsWith("unix://"), "Docker local requis");
}
