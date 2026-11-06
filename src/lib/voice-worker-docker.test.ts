import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (...parts: string[]) => readFileSync(path.join(process.cwd(), ...parts), "utf8");

describe("artefacts Docker du worker vocal (statique, sans démon Docker)", () => {
  const dockerfile = read("docker", "voice-worker", "Dockerfile");
  const compose = read("docker", "voice-worker", "compose.yaml");

  it(".dockerignore racine : exclut secrets, git, dépendances, journaux et tests sans retirer ce dont le Dockerfile a besoin", () => {
    const patterns = read(".dockerignore").split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    for (const excluded of [".env*", ".git", "node_modules", ".next", "logs", "scratch", "**/*.test.ts", "**/*.test.tsx"]) {
      expect(patterns, excluded).toContain(excluded);
    }
    expect(patterns).toContain("!.env.example");
    // Chemins utilisés par le Dockerfile (COPY, build Next, CMD) : aucun motif d'exclusion ne doit les couvrir.
    const positive = patterns.filter(p => !p.startsWith("!"));
    for (const needed of ["package.json", "package-lock.json", "prisma", "src", "public", "scripts/gamenight-server.mjs", "next.config.ts", "tsconfig.json", "postcss.config.mjs"]) {
      const covered = positive.some(p => !p.includes("*") && (needed === p || needed.startsWith(`${p}/`)));
      expect(covered, `${needed} est exclu du contexte Docker`).toBe(false);
      expect(existsSync(path.join(process.cwd(), needed)), `${needed} manquant`).toBe(true);
    }
    for (const copied of ["COPY package.json package-lock.json ./", "COPY prisma ./prisma", "COPY . ."]) expect(dockerfile).toContain(copied);
    expect(dockerfile).toContain("scripts/gamenight-server.mjs");
  });

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

  it("l'unité systemd est syntaxiquement cohérente (analyse statique ; systemd-analyze verify reste à faire sur l'hôte)", () => {
    const sections = new Map<string, string[]>();
    let current = "";
    for (const line of read("packaging", "systemd", "gamenight.service").split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      const header = /^\[(Unit|Service|Install)\]$/.exec(line);
      if (header) { current = header[1]; sections.set(current, []); continue; }
      expect(current, `directive hors section : ${line}`).not.toBe("");
      expect(line, `ligne invalide : ${line}`).toMatch(/^[A-Za-z]+=.*$/);
      sections.get(current)!.push(line);
    }
    expect([...sections.keys()]).toEqual(["Unit", "Service", "Install"]);
    const service = sections.get("Service")!;
    expect(service).toContain("ExecStart=/usr/bin/node /opt/gamenight/current/scripts/gamenight-server.mjs");
    expect(service).toContain("EnvironmentFile=/etc/gamenight/gamenight.env");
    expect(sections.get("Unit")).toEqual(expect.arrayContaining(["StartLimitIntervalSec=300", "StartLimitBurst=5"]));
    expect(sections.get("Install")).toEqual(["WantedBy=multi-user.target"]);
    expect(service.filter(l => /^(User|Group)=/.test(l))).toEqual(["User=gamenight", "Group=gamenight"]);
  });

  it("le modèle d'environnement privé ne contient que des noms (aucune valeur hors du drapeau éteint)", () => {
    const template = read("docker", "voice-worker", "voice-worker.env.example");
    const assignments = template.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l));
    expect(assignments.filter(l => !l.endsWith("="))).toEqual(["VOICE_PRESENCE_ENABLED=false"]);
    for (const name of ["DATABASE_URL", "DISCORD_BOT_TOKEN", "DISCORD_BOT_GUILD_ID", "VOICE_PRESENCE_CONSENT_DECISION", "VOICE_PRESENCE_RETENTION_DECISION"]) {
      expect(assignments).toContain(`${name}=`);
    }
    expect(template).not.toMatch(/^export /m);
  });
});
