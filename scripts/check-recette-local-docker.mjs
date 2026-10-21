import assert from "node:assert/strict";
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
console.log("OK local Docker contexts are accepted; remote and empty contexts are rejected");