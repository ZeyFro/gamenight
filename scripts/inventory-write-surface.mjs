// Inventaire GÉNÉRÉ des surfaces qui peuvent écrire en base (routes HTTP, crons, backfills, webhooks, server actions, after()).
//   node scripts/inventory-write-surface.mjs                 : tableau Markdown sur la sortie standard
//   node scripts/inventory-write-surface.mjs --out=docs/LIVRAISON-BARRIERE.md : remplace le bloc entre les marqueurs INVENTAIRE
//   node scripts/inventory-write-surface.mjs --check=docs/LIVRAISON-BARRIERE.md : code 1 si le bloc du document est périmé
// Les gardes (CRON_SECRET, signature, session, jeton) ne sont cherchées que dans le point d'entrée et ses imports directs.
// Méthode : analyse statique par expressions régulières (pas d'exécution). « Écriture atteignable » = un fichier du graphe
// d'imports du point d'entrée (résolution `@/` et relative, hors tests) contient un appel d'écriture Prisma / SQL brut :
// SURESTIMATION volontaire (un import n'est pas un appel). Les effets externes (fetch, Discord, push) ne sont pas arrêtés par la base.
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const BEGIN = "<!-- INVENTAIRE:DEBUT (généré par scripts/inventory-write-surface.mjs) -->";
const END = "<!-- INVENTAIRE:FIN -->";

const WRITE = /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(|\$executeRaw|\$transaction|\$queryRaw(?:Unsafe)?\s*[`(]\s*[`"']?\s*(?:INSERT|UPDATE|DELETE)/;
const EXTERNAL = /\bfetch\s*\(|discord-rest|discord-dm|web-push|webpush|sendNotification/;
const AFTER = /\bafter\s*\(/;
const GUARDS = [
  [/CRON_SECRET|verifyCronRequest|authorizeCron/, "CRON_SECRET (Bearer)"],
  [/Ed25519|verifyKey|DISCORD_APP_PUBLIC_KEY|x-signature-ed25519/i, "signature Ed25519 Discord"],
  [/\bauth\s*\(\s*\)|getSessionUser|requireUser|requireAdmin/, "session utilisateur"],
  [/params[^;]{0,80}token|searchParams\.get\(["']token/i, "jeton dans l'URL"],
];

const read = (file) => readFileSync(file, "utf8");
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? walk(full) : [full];
});
const isTest = (file) => /\.(test|spec)\.[tj]sx?$/.test(file);

function resolveImport(from, spec) {
  const base = spec.startsWith("@/") ? join(ROOT, "src", spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile() && !isTest(candidate)) return candidate;
  }
  return null;
}

const closureCache = new Map();
/** Fichiers atteignables par imports statiques depuis `entry` (inclus). */
export function closure(entry) {
  if (closureCache.has(entry)) return closureCache.get(entry);
  const seen = new Set([entry]);
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    for (const match of read(file).matchAll(/(?:import|export)\s[^;]*?from\s+["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g)) {
      const target = resolveImport(file, match[1] ?? match[2]);
      if (target && !seen.has(target)) { seen.add(target); stack.push(target); }
    }
  }
  closureCache.set(entry, seen);
  return seen;
}

function analyse(entry) {
  const files = [...closure(entry)];
  const own = read(entry);
  const direct = [entry, ...[...own.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => resolveImport(entry, m[1])).filter(Boolean)];
  const writers = files.filter((file) => WRITE.test(read(file)));
  return {
    writes: writers.length ? (WRITE.test(own) ? "directe" : `via ${writers.length} fichier(s)`) : "non",
    external: files.some((file) => EXTERNAL.test(read(file))),
    after: files.some((file) => AFTER.test(read(file))),
    // gardes cherchées dans le point d'entrée et ses imports directs seulement (pas tout le graphe : trop de faux positifs)
    guards: GUARDS.filter(([re]) => direct.some((file) => re.test(read(file)))).map(([, label]) => label),
  };
}

const kindOf = (route) => {
  if (route.startsWith("cron/")) return "cron";
  if (route.startsWith("backfill/")) return "backfill";
  if (route.startsWith("discord/")) return "webhook-discord";
  if (route.startsWith("steam/") || route.startsWith("auth/")) return "authentification";
  return "autre";
};

// Levier pour rendre le point d'entrée inopérant pendant la fenêtre, et ce que la barrière base garantit dans tous les cas.
export const LEVERS = {
  cron: "Désactiver le job chez le planificateur externe (cron-job.org) ; retirer `CRON_SECRET` ne vaut que pour un NOUVEAU déploiement (les variables Vercel ne sont pas réinjectées dans un déploiement existant). Sinon : la barrière suffit, les écritures échouent.",
  backfill: "Même levier que les crons (déclenchés à la main ou par job externe) : ne pas les lancer pendant la fenêtre ; la barrière suffit pour la base.",
  "webhook-discord": "Appelé par Discord : ne pas le désactiver côté Discord sans nécessité ; la barrière fait échouer les écritures (Discord peut retenter). Les réponses sans base restent possibles.",
  authentification: "Connexion Discord/Steam : lectures et écritures de session échouent pendant la barrière (site indisponible). Rien à retirer.",
  autre: "Rien à retirer : les écritures échouent avec la barrière ; les lectures échouent aussi pour l'ancien rôle.",
};

export function buildInventory() {
  const api = walk(join(ROOT, "src/app/api")).filter((file) => /route\.ts$/.test(file)).sort();
  const routes = api.map((file) => {
    const route = relative(join(ROOT, "src/app/api"), file).replace(/\\/g, "/").replace(/\/route\.ts$/, "");
    const methods = [...read(file).matchAll(/export\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
    return { route: `/api/${route}`, kind: kindOf(route), methods: [...new Set(methods)], ...analyse(file) };
  });
  const actions = walk(join(ROOT, "src")).filter((file) => /\.(ts|tsx)$/.test(file) && !isTest(file))
    .filter((file) => /^\s*(?:["']use server["'])/m.test(read(file).slice(0, 400)))
    .sort().map((file) => ({
      file: relative(ROOT, file).replace(/\\/g, "/"),
      exports: [...read(file).matchAll(/export\s+async\s+function\s+(\w+)/g)].length,
      ...analyse(file),
    }));
  const afterFiles = walk(join(ROOT, "src")).filter((file) => /\.(ts|tsx)$/.test(file) && !isTest(file) && AFTER.test(read(file)))
    .map((file) => relative(ROOT, file).replace(/\\/g, "/")).sort();
  return { routes, actions, afterFiles };
}

export function renderInventory({ routes, actions, afterFiles }) {
  const yes = (value) => (value ? "oui" : "non");
  const out = [];
  out.push(`Routes HTTP (${routes.length}) :`, "", "| Route | Méthodes | Type | Écriture base | Effets externes | `after()` | Garde détectée |", "|---|---|---|---|---|---|---|");
  for (const r of routes) out.push(`| \`${r.route}\` | ${r.methods.join(", ") || "?"} | ${r.kind} | ${r.writes} | ${yes(r.external)} | ${yes(r.after)} | ${r.guards.join(" ; ") || "aucune détectée"} |`);
  out.push("", "Leviers par type (la barrière base s'applique à tous) :", "", "| Type | Levier pendant la fenêtre |", "|---|---|");
  for (const kind of [...new Set(routes.map((r) => r.kind))]) out.push(`| ${kind} | ${LEVERS[kind]} |`);
  out.push("", `Server actions (${actions.length} fichiers \`"use server"\`) : exécutées par l'application déployée, donc par le rôle de CE déploiement ; ancien déploiement = ancien rôle = bloqué par la barrière. Aucun levier hors barrière ou pause du projet.`, "", "| Fichier | Actions async | Écriture base | Effets externes |", "|---|---|---|---|");
  for (const a of actions) out.push(`| \`${a.file}\` | ${a.exports} | ${a.writes} | ${yes(a.external)} |`);
  out.push("", `Fichiers utilisant \`after()\` (tâches différées qui survivent à la réponse, donc aux crons et actions qui les lancent) : ${afterFiles.map((f) => `\`${f}\``).join(", ")}.`);
  return out.join("\n");
}

const block = () => `${BEGIN}\n\n${renderInventory(buildInventory())}\n\n${END}`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const target = arg("out") ?? arg("check");
  if (!target) console.log(block());
  else {
    const file = resolve(target);
    const text = read(file).replace(/\r\n/g, "\n");
    const start = text.indexOf(BEGIN);
    const stop = text.indexOf(END);
    if (start < 0 || stop < start) { console.error("Marqueurs INVENTAIRE absents du document"); process.exit(2); }
    const next = text.slice(0, start) + block() + text.slice(stop + END.length);
    if (arg("check")) {
      if (next !== text) { console.error("Inventaire périmé : relancer avec --out"); process.exit(1); }
      console.log("Inventaire à jour");
    } else { writeFileSync(file, next); console.log(`Inventaire écrit dans ${target}`); }
  }
}
