import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

describe("artefacts Docker du worker vocal (statique, sans démon Docker)", () => {
  const dockerfile = read("docker", "voice-worker", "Dockerfile");
  const compose = read("docker", "voice-worker", "compose.yaml");

  it("tourne sans privilèges, avec healthcheck et arrêt propre", () => {
    expect(dockerfile).toMatch(/^USER node$/m);
    expect(dockerfile).toMatch(/^HEALTHCHECK /m);
    expect(dockerfile).toMatch(/^STOPSIGNAL SIGTERM$/m);
    expect(dockerfile).toContain("npx next build");
    expect(dockerfile).not.toMatch(/^RUN .*npm run build/m);
    expect(compose).toMatch(/restart: unless-stopped/);
    expect(compose).toMatch(/stop_grace_period: 45s/);
    expect(compose).toMatch(/cap_drop: \[ALL\]/);
  });

  it("garde la collecte éteinte par défaut et ne contient aucune valeur secrète", () => {
    expect(dockerfile).toMatch(/VOICE_PRESENCE_ENABLED=false/);
    expect(compose).toContain("VOICE_PRESENCE_ENABLED: ${VOICE_PRESENCE_ENABLED:-false}");
    for (const name of ["DATABASE_URL", "DISCORD_BOT_TOKEN", "AUTH_SECRET", "CRON_SECRET"]) {
      expect(compose).toContain(`${name}: \${${name}:-}`);
    }
    expect(compose).not.toMatch(/neon\.tech|postgresql:\/\/|Bot [A-Za-z0-9._-]{20,}|[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27}/);
    // Le seul mot de passe littéral est celui du Postgres jetable de test (profil désactivé).
    expect(compose.match(/POSTGRES_PASSWORD: .+/g)).toEqual(["POSTGRES_PASSWORD: test"]);
    expect(compose).toContain("127.0.0.1:55461:5432");
  });

  it("n'active aucun flag ni cron vocal dans les fichiers versionnés", () => {
    expect(read(".env.example")).toMatch(/^VOICE_PRESENCE_ENABLED=$/m);
    expect(read("packaging", "systemd", "gamenight.service")).toMatch(/^Environment=VOICE_PRESENCE_ENABLED=false$/m);
    expect(read("vercel.json").toLowerCase()).not.toContain("voice");
  });

  it("borne les redémarrages et l'arrêt (anti boucle de crash, délai d'arrêt cohérent)", () => {
    const unit = read("packaging", "systemd", "gamenight.service");
    expect(unit).toMatch(/^Restart=on-failure$/m);
    expect(unit).toMatch(/^RestartSec=5s$/m);
    expect(unit).toMatch(/^StartLimitIntervalSec=300$/m);
    expect(unit).toMatch(/^StartLimitBurst=5$/m);
    expect(unit).toMatch(/^TimeoutStopSec=45s$/m);
    expect(compose).toContain("VOICE_WORKER_SHUTDOWN_TIMEOUT_MS: ${VOICE_WORKER_SHUTDOWN_TIMEOUT_MS:-}");
    // Le délai applicatif par défaut (40 s) reste sous le délai de grâce de l'orchestrateur (45 s).
    expect(read("scripts", "gamenight-server.mjs")).toContain("DEFAULT_SHUTDOWN_TIMEOUT_MS = 40_000");
  });
});
