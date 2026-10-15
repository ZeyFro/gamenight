#!/usr/bin/env node
// Porte de merge de la boucle roadmap + outils de statut. Aucune dépendance.
// Sous-commandes (le script PowerShell les appelle ; seul `gate` parle à GitHub, via `gh`) :
//   gate <pr>                           évalue la PR → JSON {ok, reasons, item, headSha}
//   status <ID> <fait|echec|a-toi>      met à jour la ligne de docs/ROADMAP.md (raison sur stdin)
//   morning <état.json> <roadmap.md> <sortie.md>   régénère logs/MORNING.md
// La logique pure (evaluateGate, checkMigrationSql, setItemStatus, summarize) est testée dans
// src/lib/roadmap-gate.test.ts. Ce fichier est protégé : une PR de la boucle ne peut pas le modifier.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const BRANCH_RE = /^claude\/lot([1-7])-[a-z0-9][a-z0-9-]*$/;
export const ITEM_MARKER_RE = /<!-- roadmap-item: (L[1-7]-\d\d) -->/;
const ITEM_TITLE_RE = /\[(L[1-7]-\d\d)\]\s*$/;
const MIGRATION_FILE_RE = /^prisma\/migrations\/\d{14}_[A-Za-z0-9_]+\/migration\.sql$/;

/** Fichiers qu'une PR de la boucle ne peut jamais toucher. */
const PROTECTED = [
  [/^\.github\//, ".github/"],
  [/^\.claude\//, ".claude/"],
  [/^scripts\/(work-roadmap\.ps1|roadmap-[^/]+)$/, "scripts de la boucle"],
  [/^src\/lib\/roadmap-gate\.test\.ts$/, "test de la porte"],
  [/(^|\/)\.env[^/]*$/, ".env*"],
  [/(^|\/)(package\.json|package-lock\.json|vercel\.json)$/, "package.json / package-lock.json / vercel.json"],
  [/(^|\/)next\.config\.[cm]?[jt]s$/, "next.config"],
];

const norm = (s) => s.replace(/\r\n/g, "\n");

/** Retire commentaires SQL, puis découpe sur `;` hors guillemets. */
export function splitSql(sql) {
  let out = "";
  let i = 0;
  const s = norm(sql);
  let q = null;
  while (i < s.length) {
    const c = s[i];
    const n = s[i + 1];
    if (!q && c === "-" && n === "-") {
      while (i < s.length && s[i] !== "\n") i++;
      continue;
    }
    if (!q && c === "/" && n === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"') q = q === c ? null : q ?? c;
    out += c;
    i++;
  }
  const stmts = [];
  let cur = "";
  q = null;
  for (const c of out) {
    if (c === "'" || c === '"') q = q === c ? null : q ?? c;
    if (c === ";" && !q) {
      if (cur.trim()) stmts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

/** Découpe les actions d'un ALTER TABLE sur les virgules de premier niveau. */
function splitActions(s) {
  const parts = [];
  let depth = 0;
  let q = null;
  let cur = "";
  for (const c of s) {
    if (c === "'" || c === '"') q = q === c ? null : q ?? c;
    if (!q && c === "(") depth++;
    if (!q && c === ")") depth--;
    if (!q && depth === 0 && c === ",") {
      parts.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)`;
const lastIdent = (m) => {
  const parts = m.match(new RegExp(IDENT, "g")) ?? [];
  return (parts[parts.length - 1] ?? "").replace(/"/g, "");
};

/**
 * Migrations NOUVELLES de la PR : liste blanche. Admis : CREATE TABLE / TYPE / INDEX (sur objets nouveaux),
 * ADD COLUMN nullable ou avec DEFAULT, contraintes sur une table créée dans la même PR.
 * @param {Record<string,string>} files chemin → SQL
 * @returns {string[]} raisons de refus
 */
export function checkMigrationSql(files) {
  const reasons = [];
  const all = Object.entries(files).map(([path, sql]) => [path, splitSql(sql)]);
  const newTables = new Set();
  for (const [, stmts] of all) {
    for (const s of stmts) {
      const m = s.match(new RegExp(String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?((?:${IDENT}\.)?${IDENT})`, "i"));
      if (m) newTables.add(lastIdent(m[1]));
    }
  }
  for (const [path, stmts] of all) {
    const refuse = (why, s) => reasons.push(`${path} : ${why} — « ${s.replace(/\s+/g, " ").slice(0, 90)} »`);
    for (const s of stmts) {
      if (s.includes("$$")) {
        refuse("bloc procédural ($$) non analysable", s);
        continue;
      }
      const kw = s.replace(/'(?:[^']|'')*'/g, "''").replace(/"[^"]*"/g, '"_"').replace(/\s+/g, " ").trim();
      const u = kw.toUpperCase();
      if (/\bDROP\b/.test(u)) refuse("DROP interdit", s);
      else if (/\bRENAME\b/.test(u)) refuse("RENAME interdit", s);
      else if (/\bTRUNCATE\b/.test(u)) refuse("TRUNCATE interdit", s);
      else if (/^DELETE\b/.test(u)) refuse("DELETE interdit", s);
      else if (/^UPDATE\b/.test(u)) refuse("UPDATE interdit", s);
      else if (/\bALTER COLUMN\b.*\b(TYPE|SET DATA TYPE)\b/.test(u)) refuse("changement de type interdit", s);
      else if (/^CREATE TABLE\b/.test(u) || /^CREATE TYPE\b/.test(u)) continue;
      else if (/^CREATE (UNIQUE )?INDEX\b/.test(u)) {
        const m = s.match(new RegExp(String.raw`\bON\s+(?:ONLY\s+)?((?:${IDENT}\.)?${IDENT})`, "i"));
        const table = m ? lastIdent(m[1]) : "";
        if (/^CREATE UNIQUE\b/.test(u) && !newTables.has(table)) refuse("index UNIQUE sur une table existante", s);
      } else if (/^ALTER TABLE\b/.test(u)) {
        const m = s.match(new RegExp(String.raw`^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?((?:${IDENT}\.)?${IDENT})([\s\S]*)$`, "i"));
        if (!m) {
          refuse("ALTER TABLE illisible", s);
          continue;
        }
        const table = lastIdent(m[1]);
        const isNew = newTables.has(table);
        for (const action of splitActions(m[2])) {
          const a = action.replace(/'(?:[^']|'')*'/g, "''").replace(/\s+/g, " ").trim().toUpperCase();
          if (/^ADD COLUMN\b/.test(a)) {
            if (isNew) continue;
            if (/\bNOT NULL\b/.test(a) && !/\bDEFAULT\b/.test(a)) refuse("NOT NULL sans DEFAULT sur une table existante", s);
            else if (/\b(UNIQUE|PRIMARY KEY|REFERENCES)\b/.test(a)) refuse("UNIQUE/clé étrangère sur une table existante", s);
          } else if (/^ADD (CONSTRAINT|FOREIGN KEY|UNIQUE|PRIMARY KEY|CHECK)\b/.test(a)) {
            if (!isNew) refuse("contrainte sur une table existante", s);
          } else refuse("action ALTER TABLE non admise", s);
        }
      } else refuse("instruction non admise (liste blanche)", s);
    }
  }
  return reasons;
}

/**
 * @param {{branch:string, base:string, body:string, title?:string, sameRepo:boolean,
 *   files:{filename:string,status:string,previous_filename?:string}[], newMigrations?:Record<string,string>}} pr
 */
export function evaluateGate(pr) {
  const reasons = [];
  const bm = BRANCH_RE.exec(pr.branch ?? "");
  if (!bm) reasons.push(`branche « ${pr.branch} » hors de claude/lot[1-7]-*`);
  if (pr.base !== "main") reasons.push(`base « ${pr.base} » au lieu de main`);
  if (!pr.sameRepo) reasons.push("PR issue d'un fork");
  const item = (ITEM_MARKER_RE.exec(pr.body ?? "") ?? ITEM_TITLE_RE.exec(pr.title ?? ""))?.[1] ?? null;
  if (!item) reasons.push("identifiant d'élément absent (marqueur roadmap-item ou [Lx-yy] dans le titre)");
  else if (bm && item[1] !== bm[1]) reasons.push(`lot de la branche (${bm[1]}) différent de celui de ${item}`);
  const files = pr.files ?? [];
  if (!files.length) reasons.push("aucun fichier modifié");
  if ((pr.branch ?? "").endsWith("-statut")) {
    const bad = files.filter((f) => f.filename !== "docs/ROADMAP.md");
    if (bad.length) reasons.push(`PR de statut : seul docs/ROADMAP.md est admis (trouvé : ${bad.map((f) => f.filename).join(", ")})`);
  }
  const newSql = {};
  for (const f of files) {
    for (const p of [f.filename, f.previous_filename].filter(Boolean)) {
      for (const [re, label] of PROTECTED) {
        if (re.test(p) && !/(^|\/)\.env\.example$/.test(p)) reasons.push(`fichier protégé (${label}) : ${p}`);
      }
    }
    if (f.filename.startsWith("prisma/migrations/")) {
      if (f.status !== "added") reasons.push(`migration existante ${f.status} : ${f.filename}`);
      else if (!MIGRATION_FILE_RE.test(f.filename)) reasons.push(`fichier inattendu dans prisma/migrations : ${f.filename}`);
      else if (typeof pr.newMigrations?.[f.filename] !== "string") reasons.push(`SQL illisible : ${f.filename}`);
      else newSql[f.filename] = pr.newMigrations[f.filename];
    }
  }
  reasons.push(...checkMigrationSql(newSql));
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], item };
}

const cap = (s) => (s || "").replace(/[|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);

/** Change la dernière cellule (Statut) de la ligne `| ID |` de docs/ROADMAP.md. */
export function setItemStatus(md, id, kind, reason = "") {
  const label =
    kind === "fait" ? "Fait" : kind === "echec" ? `ÉCHEC — ${cap(reason)}` : kind === "a-toi" ? `À TOI — ${cap(reason)}` : null;
  if (!label) throw new Error(`statut inconnu : ${kind}`);
  const lines = norm(md).split("\n");
  const i = lines.findIndex((l) => l.startsWith(`| ${id} |`));
  if (i < 0) throw new Error(`élément introuvable : ${id}`);
  lines[i] = lines[i].replace(/\|[^|]*\|\s*$/, `| ${label} |`);
  return lines.join("\n");
}

/** Lignes d'éléments du suivi : { id, name, lot, nature, status }. */
export function summarize(md) {
  const rows = [];
  for (const l of norm(md).split("\n")) {
    const m = /^\| (L([1-7])-\d\d) \|/.exec(l);
    if (!m) continue;
    const c = l.split("|").map((x) => x.trim());
    rows.push({ id: m[1], lot: Number(m[2]), name: c[2], nature: c[c.length - 3], status: c[c.length - 2] });
  }
  return rows;
}

/** @param state {startedAt, merged:[{pr,item,url}], failed:[{pr,item,reason}], toi:[{item,reason}], deployFailure?:{pr,url}} */
export function renderMorning(state, md, now = new Date()) {
  const rows = summarize(md);
  const code = rows.filter((r) => r.nature === "code");
  const done = code.filter((r) => r.status.startsWith("Fait"));
  const out = [];
  if (state.deployFailure) out.push(`# DÉPLOIEMENT EN ÉCHEC après la PR #${state.deployFailure.pr} — ${state.deployFailure.url ?? "lien indisponible"}`, "");
  else out.push("# MORNING — bilan de la boucle roadmap", "");
  out.push(`Heure : ${now.toISOString().replace("T", " ").slice(0, 19)} UTC · démarrée : ${state.startedAt ?? "?"}`);
  out.push(`Éléments de nature code faits : **${done.length} / ${code.length}**`, "");
  out.push("## Ce qui n'est PAS fait");
  const notDone = rows.filter((r) => !r.status.startsWith("Fait"));
  const byStatus = (p) => notDone.filter((r) => r.status.startsWith(p));
  for (const r of byStatus("ÉCHEC")) out.push(`- ${r.id} ${r.name} — ${r.status}`);
  for (const r of byStatus("À TOI")) out.push(`- ${r.id} ${r.name} — ${r.status}`);
  for (const f of state.failed ?? []) out.push(`- (session) ${f.item ?? "?"} PR #${f.pr} — ${f.reason}`);
  const todo = notDone.filter((r) => r.status.startsWith("À faire") && r.nature === "code");
  out.push(`- ${todo.length} élément(s) de nature code encore « À faire »${todo.length ? ` (prochain : ${todo[0].id} ${todo[0].name})` : ""}`, "");
  out.push("## PR fusionnées cette session");
  for (const m of state.merged ?? []) out.push(`- #${m.pr} ${m.item ?? ""} ${m.url ?? ""}`);
  if (!(state.merged ?? []).length) out.push("- aucune");
  out.push("", "## PR en échec (restées en Draft)");
  for (const f of state.failed ?? []) out.push(`- #${f.pr} ${f.item ?? ""} — ${f.reason}`);
  if (!(state.failed ?? []).length) out.push("- aucune");
  out.push("", "## Éléments « À TOI »");
  for (const t of state.toi ?? []) out.push(`- ${t.item} — ${t.reason}`);
  for (const r of byStatus("À TOI")) out.push(`- ${r.id} — ${r.status}`);
  return out.join("\n") + "\n";
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function gateFromGitHub(n) {
  const repo = gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").trim();
  const pr = JSON.parse(gh("api", `repos/${repo}/pulls/${n}`));
  const files = gh("api", "--paginate", `repos/${repo}/pulls/${n}/files`, "--jq", ".[]|{filename,status,previous_filename}")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
  const newMigrations = {};
  for (const f of files) {
    if (f.status === "added" && MIGRATION_FILE_RE.test(f.filename)) {
      newMigrations[f.filename] = gh("api", "-H", "Accept: application/vnd.github.raw", `repos/${repo}/contents/${f.filename}?ref=${pr.head.sha}`);
    }
  }
  const res = evaluateGate({
    branch: pr.head.ref,
    base: pr.base.ref,
    body: pr.body ?? "",
    title: pr.title ?? "",
    sameRepo: pr.head.repo?.full_name === pr.base.repo?.full_name,
    files,
    newMigrations,
  });
  return { ...res, headSha: pr.head.sha, pr: Number(n) };
}

const readStdin = () => {
  try {
    return readFileSync(0, "utf8").replace(/^﻿/, "");
  } catch {
    return "";
  }
};

function main(argv) {
  const [cmd, ...a] = argv;
  if (cmd === "gate") {
    const res = gateFromGitHub(a[0]);
    process.stdout.write(JSON.stringify(res));
    process.exit(res.ok ? 0 : 1);
  } else if (cmd === "status") {
    const [id, kind] = a;
    const path = a[2] ?? "docs/ROADMAP.md";
    writeFileSync(path, setItemStatus(readFileSync(path, "utf8"), id, kind, readStdin()));
  } else if (cmd === "summary") {
    process.stdout.write(JSON.stringify(summarize(readFileSync(a[0], "utf8"))));
  } else if (cmd === "morning") {
    const state = JSON.parse(readFileSync(a[0], "utf8").replace(/^﻿/, ""));
    writeFileSync(a[2], renderMorning(state, readFileSync(a[1], "utf8")));
  } else {
    console.error("usage : gate <pr> | status <ID> <fait|echec|a-toi> [fichier] | summary <fichier> | morning <état> <roadmap> <sortie>");
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
