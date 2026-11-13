import { readFileSync, mkdtempSync, writeFileSync, chmodSync, existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const workflow = require("js-yaml").load(readFileSync(".github/workflows/tower-team-daily.yml", "utf8"));
const step = workflow.jobs["assign-daily-challenges"].steps[0];

function run(enabled: string | undefined, configured = false, responseEnabled = true) {
  const dir = mkdtempSync(join(tmpdir(), "gamenight-cron-test-"));
  try {
    const marker = join(dir, "http-called");
    writeFileSync(join(dir, "date"), "#!/bin/sh\nprintf '09\\n'\n");
    writeFileSync(join(dir, "curl"), `#!/bin/sh\nset -eu\ntouch "$HTTP_MARKER"\nwhile [ "$#" -gt 0 ]; do\n if [ "$1" = '--output' ]; then shift; output="$1"; fi\n shift\ndone\nprintf '%s' '${JSON.stringify({ enabled: responseEnabled, failed: 0, complete: true })}' > "$output"\nprintf '200'\n`);
    for (const command of ["date", "curl"]) chmodSync(join(dir, command), 0o700);
    const result = spawnSync("bash", ["-c", step.run], {
      env: {
        PATH: `${dir}:/usr/bin:/bin`, HOME: dir, HTTP_MARKER: marker, NODE_ENV: "test",
        ...(enabled === undefined ? {} : { TOWER_TEAM_DAILY_ENABLED: enabled }),
        ...(configured ? { GAMENIGHT_CRON_BASE_URL: "https://example.invalid", CRON_SECRET: "synthetic-test-only" } : {}),
      }, encoding: "utf8", timeout: 5000,
    });
    return { status: result.status, called: existsSync(marker), output: result.stdout + result.stderr };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

it("déclare le contrat Ubuntu/Bash et la variable d'activation Actions", () => {
  expect(workflow.jobs["assign-daily-challenges"]["runs-on"]).toBe("ubuntu-latest");
  expect(step.shell).toBe("bash");
  expect(step.env.TOWER_TEAM_DAILY_ENABLED).toBe("${{ vars.TOWER_TEAM_DAILY_ENABLED }}");
});

// Exécution native du workflow Ubuntu, pas une émulation de Bash sous Windows.
// Sur Linux, tout outil manquant doit faire échouer les tests, pas les ignorer.
describe.skipIf(process.platform !== "linux")("cron équipe Ubuntu : activation explicite avant tout accès distant", () => {
  it.each([undefined, "", "false", "TRUE", "1"])("reste inactif pour %s, sans secret ni appel HTTP", enabled => {
    const result = run(enabled);
    expect(result.status).toBe(0);
    expect(result.called).toBe(false);
    expect(result.output).toContain("disabled");
  });
  it("ne démarre pas même si les identifiants sont déjà configurés", () => {
    expect(run(undefined, true)).toMatchObject({ status: 0, called: false });
  });
  it("conserve un échec visible quand activé sans configuration", () => {
    expect(run("true")).toMatchObject({ status: 1, called: false });
  });
  it("appelle la route après activation et configuration explicites", () => {
    expect(run("true", true)).toMatchObject({ status: 0, called: true });
    expect(step.env.TOWER_TEAM_DAILY_ENABLED).toBe("${{ vars.TOWER_TEAM_DAILY_ENABLED }}");
  });
  it("refuse toujours une route désactivée après activation du schedule", () => {
    expect(run("true", true, false)).toMatchObject({ status: 1, called: true });
  });
});
