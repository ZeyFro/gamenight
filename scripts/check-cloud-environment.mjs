import { execFileSync } from "node:child_process";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Validate before loading Prisma or making a database connection. Never echo URLs. */
export function validateCloudSettings({ nodeVersion, databaseUrl, tlsVerification, ignoreChecksum }) {
  if (nodeVersion.split(".")[0] !== "22") throw new Error("Node.js 22 requis");
  if (tlsVerification === "0") throw new Error("Vérification TLS désactivée");
  if (ignoreChecksum) throw new Error("Contournement de checksum Prisma interdit");
  let url;
  try { url = new URL(databaseUrl); } catch { throw new Error("TEST_DATABASE_URL locale requise"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol)
    || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || [...url.searchParams.keys()].some(key => key.toLowerCase() === "host")) {
    throw new Error("TEST_DATABASE_URL doit viser le loopback sans redirection host");
  }
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let step = "configuration";
  let db;
  try {
    validateCloudSettings({
      nodeVersion: process.versions.node,
      databaseUrl: process.env.TEST_DATABASE_URL,
      tlsVerification: process.env.NODE_TLS_REJECT_UNAUTHORIZED,
      ignoreChecksum: process.env.PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING,
    });
    console.log(`Node.js ${process.versions.node} : OK`);
    const run = (command, args) => execFileSync(command, args, {
      cwd: root, encoding: "utf8", timeout: 30_000, stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    step = "Git et instructions";
    const head = run("git", ["rev-parse", "--verify", "HEAD"]);
    for (const file of ["AGENTS.md", "docs/ETAT.md", "docs/REPRISE_AUTONOME.md"]) await access(resolve(root, file));
    console.log(`Git ${head} ; instructions présentes : OK`);
    step = "npm et TLS";
    const npmVersion = run("npm", ["--version"]);
    if (run("npm", ["config", "get", "strict-ssl"]) !== "true") throw new Error("TLS npm désactivé");
    console.log(`npm ${npmVersion} ; strict-ssl : OK`);
    step = "binaires Prisma";
    run(process.execPath, [resolve(root, "node_modules/prisma/build/index.js"), "--version"]);
    console.log("CLI et binaires Prisma : OK");
    step = "PostgreSQL local";
    const { PrismaClient } = await import("@prisma/client");
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.searchParams.set("connect_timeout", "5");
    url.searchParams.set("pool_timeout", "5");
    url.searchParams.set("options", "-c statement_timeout=5000");
    db = new PrismaClient({ datasourceUrl: url.href, log: [] });
    const rows = await db.$queryRaw`SELECT 1 AS ready`;
    if (rows[0]?.ready !== 1) throw new Error("Réponse SQL inattendue");
    console.log("PostgreSQL local ; SELECT 1 : OK");
    console.log("Précontrôle réussi ; tests, schéma, CI et intégrations restent à vérifier pour chaque tâche.");
  } catch {
    // Errors from external tools may contain credentials: report only the failed stage.
    console.error(`Échec du précontrôle : ${step}. Vérifier les prérequis documentés, sans publier de secrets.`);
    process.exitCode = 1;
  } finally {
    if (db) await db.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
