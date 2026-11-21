// Génère docs/preuves/TRACABILITE.md et docs/preuves/tracabilite.json à partir de :
//  - docs/COUVERTURE_CAHIER.md (les 127 lignes du cahier),
//  - docs/preuves/tests-resultats.json (exécution réelle des tests cités),
//  - docs/preuves/captures/manifeste.json (captures Playwright locales),
//  - docs/preuves/scenarios-resultats.json (contrôles statiques).
// Règle : aucun FONCTIONNE sans preuve exécutée (test réussi ou capture + contrôle). Les totaux sont calculés ici, pas saisis.
import { readFileSync, writeFileSync } from "node:fs";

const cahier = readFileSync("docs/COUVERTURE_CAHIER.md", "utf8");
const tests = JSON.parse(readFileSync("docs/preuves/tests-resultats.json", "utf8"));
const captures = JSON.parse(readFileSync("docs/preuves/captures/manifeste.json", "utf8"));
const scenarios = JSON.parse(readFileSync("docs/preuves/scenarios-resultats.json", "utf8"));

const sectionOf = (title) => { const start = cahier.indexOf(title); const next = cahier.indexOf("\n## ", start + 5); return cahier.slice(start, next < 0 ? undefined : next); };
const rowsOf = (section) => section.split("\n").filter(line => /^\| /.test(line) && !/^\| (§|---)/.test(line)).map(line => line.split("|").slice(1, -1).map(cell => cell.trim()));
const software = rowsOf(sectionOf("## Exigences logicielles")).map(([section, text, code, flag, tested, proof]) => ({ section, text, doc: code.replace(/\*/g, ""), flag, tested, proof, kind: "logiciel" }));
const deferred = rowsOf(sectionOf("## Reportées")).map(([section, text, reason]) => ({ section, text, doc: "reportée", reason, kind: "reportée" }));
const nocode = rowsOf(sectionOf("## Sans livrable code")).map(([section, text, reason]) => ({ section, text, doc: "sans livrable code", reason, kind: "sans-code" }));
const rows = [...software, ...deferred, ...nocode].map((row, index) => ({ id: `C${String(index + 1).padStart(3, "0")}`, ...row }));
if (rows.length !== 127) throw new Error(`127 lignes attendues, ${rows.length} trouvées`);

// Lignes dont l'essence est un effet réel dans Discord : non testable en local (les tests de logique simulée restent cités).
const discordEffect = ["2.1", "2.2", "3.1", "4.1–4.2", "4.4", "6.3", "6.4", "17", "19.2", "19.3", "21.2", "27 B", "27 F", "27 G", "27 L", "27 M", "27.6"];
// Pages d'interface associées (captures liées comme preuve visuelle).
const pages = {
  "2.3": ["/profil"], "6.1": ["/tower"], "6.2": ["/admin"], "7.1": ["/tower"], "7.2": ["/tower"], "7.3": ["/tower"], "7.4": ["/tower/palmares"], "8.2": ["/tower"], "8.3": ["/tower"], "8.6": ["/tower"], "8.7": ["/tower/propositions"],
  "9.1": ["/tower"], "10.3": ["/tower/palmares"], "11.1": ["/equipes", "/equipes/candidatures"], "11.2": ["/equipes", "/equipes/gestion"], "11.3": ["/tower/forums"], "11.4": ["/equipes"],
  "12.2": ["/joueurs"], "12.3": ["/ce-soir", "/joueurs"], "12.4": ["/profil", "/profil/parametres"], "13.1": ["/sessions"], "13.2": ["/calendrier"], "13.3": ["/tournois"], "13.4": ["/ce-soir", "/roulette", "/notifications"],
  "14.1": ["/saisons"], "14.3": ["/classement", "/tower/palmares"], "14.4": ["/saisons"], "15.1": ["/profil/badges", "/profil/personnalisation", "/tower/palmares"], "16": ["/tower/palmares"], "24": ["/notifications", "/profil/parametres"],
  "27 A": ["/equipes/candidatures"], "27 C": ["/tower"], "27 D": ["/sessions"], "27 E": ["/tournois/equipes"], "27 G": ["/projets"], "27 H": ["/jouer-maintenant"], "27 I": ["/notifications"], "27 J": ["/profil/parametres", "/bibliotheque/plateformes"],
  "27 K": ["/profil/parametres", "/joueurs"], "27 M": ["/soutiens"], "27 N": ["/profil/personnalisation"], "27 O": ["/admin/tableau-de-bord"], "5.1": ["/"], "5.2": ["/"],
};
// Scénarios sans test dédié (clé = « § + début d'exigence »).
const scenarioFor = (row) => {
  if (/Aucune IA ne valide/.test(row.text)) return "ia";
  if (row.section === "9.4") return "ia";
  if (row.section === "1.4") return "boosters-cosmetique";
  if (row.section === "6.3" && row.kind === "logiciel") return "roles-etage";
  if (row.section === "7.2" && row.kind === "logiciel") return "compteur-zero";
  if (row.section === "6.2") return "admin-refuse";
  if (row.section === "9.1" && /anciennes/.test(row.text)) return "absent-preuves-anciennes";
  if (row.section === "11.2" && /Identité visuelle/.test(row.text)) return "absent-identite-equipe";
  if (row.section === "12.3" && /partenaires/.test(row.text)) return "absent-partenaires";
  if (row.section === "14.3" && /Classement d'équipes/.test(row.text)) return "absent-classement-equipes";
  if (row.section === "22.2" && /bascule/.test(row.text)) return "absent-bascule";
  return null;
};
const fileLinks = (row) => (row.proof ?? "").match(/`([^`]+\.test\.tsx?)`/g)?.map(item => item.slice(1, -1)) ?? [];
const resolveTests = (row) => fileLinks(row).flatMap(name => tests.resolved[name] ?? []);
const imageFor = (row) => (pages[row.section] ?? []).flatMap(path => captures.filter(c => c.path === path && c.status > 0 && ["actif", "nouveau", "admin", "visiteur"].includes(c.persona) && c.viewport === "bureau").slice(0, 2));

const verdicts = ["FONCTIONNE", "PARTIEL", "NE FONCTIONNE PAS", "NON TESTABLE EN LOCAL"];
const out = rows.map(row => {
  const files = [...new Set(resolveTests(row))];
  const results = files.map(file => ({ file, ...tests.results[file] })).filter(result => result.status);
  const passed = results.length > 0 && results.every(result => result.status === "passed" && result.passed > 0);
  const anyFailed = results.some(result => result.status === "failed" || result.failed > 0);
  const scenarioKey = scenarioFor(row);
  const scenario = scenarioKey ? scenarios[scenarioKey] : null;
  const images = imageFor(row);
  let verdict; let scenarioText; let reason = "";
  if (row.kind === "sans-code") {
    verdict = "NON TESTABLE EN LOCAL"; scenarioText = "Aucun scénario exécutable : principe, contenu éditorial ou action hors dépôt."; reason = row.reason;
  } else if (row.kind === "reportée") {
    verdict = "NON TESTABLE EN LOCAL"; scenarioText = "Aucun scénario : fonctionnalité reportée par décision (rien n'est livré à exécuter)."; reason = row.reason;
  } else if (row.doc === "non") {
    verdict = scenario?.ok ? "NE FONCTIONNE PAS" : "NE FONCTIONNE PAS"; scenarioText = scenario ? `Recherche d'absence exécutée : ${scenario.evidence}` : "Fonction absente du code (recherche négative non scriptée)."; reason = "Exigence non implémentée.";
  } else if (discordEffect.includes(row.section) || discordEffect.some(key => key.length > 2 && row.section === key)) {
    verdict = "NON TESTABLE EN LOCAL"; reason = "L'effet réel se produit dans Discord (serveur, rôles, salons, MP) : impossible sans appel Discord.";
    scenarioText = results.length ? `Logique simulée uniquement (clients Discord remplacés par des doublures) : ${results.map(r => `${r.file} ${r.passed}/${r.total}`).join(", ")}.` : "Aucun scénario local.";
  } else if (row.doc === "partielle") {
    verdict = anyFailed ? "NE FONCTIONNE PAS" : "PARTIEL"; reason = "Le cahier la déclare partielle ; la partie livrée est prouvée par les tests ci-dessous.";
    scenarioText = results.length ? `Tests exécutés : ${results.map(r => `${r.file} ${r.passed}/${r.total}`).join(", ")}.` : (scenario ? scenario.evidence : "Aucun test exécutable.");
  } else if (scenario && !results.length) {
    verdict = scenario.ok ? "FONCTIONNE" : "NE FONCTIONNE PAS"; scenarioText = `Scénario exécuté : ${scenario.evidence}`;
  } else if (passed) {
    verdict = "FONCTIONNE"; scenarioText = `Tests exécutés : ${results.map(r => `${r.file} ${r.passed}/${r.total}${r.skipped ? ` (${r.skipped} ignorés)` : ""}`).join(", ")}${scenario ? ` ; contrôle : ${scenario.evidence}` : ""}.`;
  } else if (anyFailed) {
    verdict = "NE FONCTIONNE PAS"; scenarioText = `Tests exécutés : ${results.map(r => `${r.file} ${r.passed}/${r.total} réussis, ${r.failed} échoués`).join(", ")}.`; reason = results.flatMap(r => r.failures).join(" | ");
  } else {
    verdict = "NON TESTABLE EN LOCAL"; scenarioText = "Aucun test ni scénario exécutable trouvé pour cette ligne."; reason = "Aucune preuve exécutable.";
  }
  if (verdict === "FONCTIONNE" && !results.length && !scenario) verdict = "NON TESTABLE EN LOCAL";
  return { id: row.id, section: row.section, text: row.text, doc: row.doc, flag: row.flag ?? "", verdict, scenario: scenarioText, reason, tests: results.map(r => ({ file: r.file, status: r.status, passed: r.passed, total: r.total })), captures: images.map(c => c.file) };
});

// Les 20 décisions du 18/11 (découpage atomique de docs/DECISIONS_TOWER.md, §27.1, §27.3–27.6 du cahier : le dépôt ne les numérote pas).
const decisionDefs = [
  ["D01", "Console : scope OAuth `connections` demandé seulement avec consentement explicite, facultatif", ["discord-connections.test.ts", "auth.connections.test.ts"], ["/profil/parametres"], "27 J"],
  ["D02", "Console : plateformes et identifiants préremplis depuis Discord, modifiables", ["discord-connections.test.ts", "game-platforms.test.ts"], ["/profil/parametres"], "27 J"],
  ["D03", "Console : ajout rapide de jeux par plateforme et « populaires sur ta plateforme »", ["game-platforms.test.ts"], ["/bibliotheque/plateformes"], "27 J"],
  ["D04", "Console : champ crossplay sur la fiche jeu", ["game-platforms.test.ts"], ["/bibliotheque/plateformes"], "27 J"],
  ["D05", "Défis : jamais de défi impossible sur les plateformes du joueur ; photo d'écran TV avec code acceptée", ["tower-challenge-proof-rules.test.ts", "tower-challenges.integration.test.ts"], ["/tower"], "27 J"],
  ["D06", "Validation automatique : défis mesurables Steam validés par cron, profil privé = repli sur le vote, MP au joueur", ["tower-steam-measure.integration.test.ts"], ["/tower"], "27 C"],
  ["D07", "Validation automatique : bouton « Signaler un doute » (membres éligibles) bascule en vote", ["tower-steam-measure.integration.test.ts", "tower-vote-eligibility.test.ts"], ["/tower"], "27 C"],
  ["D08", "Notifications : MP uniquement pour ce qui vise personnellement le joueur", ["notification-policy.test.ts"], ["/notifications"], "27 I"],
  ["D09", "Notifications : pings de rôle de jeu en opt-in + centre de notifications dans l'app, jamais @everyone", ["game-ping-optin.test.ts", "notification-policy.test.ts"], ["/notifications"], "27 I"],
  ["D10", "Notifications : annonces publiques seulement pour les moments marquants", ["notification-policy.test.ts"], ["/notifications"], "27 I"],
  ["D11", "Niveau par jeu : niveau déclaratif Débutant/Intermédiaire/Confirmé/Compétitif utilisé par matchmaking et équilibrage", ["game-levels-rules.test.ts", "game-levels-matchmaking.integration.test.ts"], ["/profil/parametres", "/joueurs"], "27 K"],
  ["D12", "Niveau par jeu : interface prête pour un rang importé (source DECLARED|IMPORTED)", ["game-levels-rules.test.ts"], ["/profil/parametres"], "27 K"],
  ["D13", "Groupes : 1 équipe principale ; projets et soirées illimités ; invité de tournoi d'une autre équipe", ["team-recruiters-rules.test.ts", "community-teams-rules.test.ts", "projects.integration.test.ts"], ["/equipes", "/projets"], "27 A"],
  ["D14", "Modération : commande « Signaler » → ticket privé staff, aucune sanction automatique, journalisé", ["discord-report-command.test.ts"], [], "27 L"],
  ["D15", "Boosters : rôle « Soutien de la Tour » sans permission, badge, mur des soutiens, salons réservés, retrait automatique", ["booster-support.test.ts"], ["/soutiens"], "27 M"],
  ["D16", "V2 : bot gateway permanent et rangs importés (documentation seulement)", [], [], "27.3"],
  ["D17", "Plus tard : VIP payant cosmétique ; champ d'entitlement sans aucun paiement implémenté", ["profile-customization.test.ts"], ["/profil/personnalisation"], "27.4"],
  ["D18", "Rappel : suppression des 134 rôles Étage avant la création automatique de rôles (action manuelle)", ["tower-etage-roles.test.ts"], [], "27.5"],
  ["D19", "Principe : tous les interrupteurs OFF par défaut, écritures Discord par la file et l'executor", ["discord-role-command.test.ts", "notification-executor.integration.test.ts"], [], "27.6"],
  ["D20", "Principe : aucune IA ne valide une preuve ; récompenses cosmétiques", [], [], "27.6"],
];
const decisionDiscord = new Set(["D01", "D14", "D15", "D18", "D19"]);
const decisions = decisionDefs.map(([id, text, names, paths, ref]) => {
  const files = [...new Set(names.flatMap(name => tests.resolved[name] ?? [name]))];
  const results = files.map(file => ({ file, ...tests.results[file] })).filter(result => result.status);
  const passed = results.length > 0 && results.every(result => result.status === "passed" && result.passed > 0);
  const images = paths.flatMap(path => captures.filter(c => c.path === path && c.status > 0 && c.viewport === "bureau" && ["actif", "nouveau"].includes(c.persona)).slice(0, 2));
  let verdict; let scenario;
  if (id === "D16") { verdict = "NON TESTABLE EN LOCAL"; scenario = "Reporté en v2 : rien à exécuter."; }
  else if (id === "D20") { verdict = scenarios.ia?.ok ? "FONCTIONNE" : "NE FONCTIONNE PAS"; scenario = `Contrôle statique : ${scenarios.ia?.evidence}`; }
  else if (decisionDiscord.has(id)) { verdict = "NON TESTABLE EN LOCAL"; scenario = results.length ? `Logique simulée seulement : ${results.map(r => `${r.file} ${r.passed}/${r.total}`).join(", ")}. L'effet réel dans Discord n'est pas testable.` : "Effet Discord."; }
  else if (passed) { verdict = "FONCTIONNE"; scenario = `Tests exécutés : ${results.map(r => `${r.file} ${r.passed}/${r.total}`).join(", ")}.`; }
  else if (results.some(result => result.failed > 0)) { verdict = "NE FONCTIONNE PAS"; scenario = results.map(r => `${r.file} ${r.failed} échec(s)`).join(", "); }
  else { verdict = "NON TESTABLE EN LOCAL"; scenario = "Aucun test exécutable."; }
  return { id, text, ref, verdict, scenario, tests: results.map(r => ({ file: r.file, status: r.status, passed: r.passed, total: r.total })), captures: images.map(c => c.file) };
});

const count = (list) => Object.fromEntries(verdicts.map(verdict => [verdict, list.filter(item => item.verdict === verdict).length]));
const totals = { cahier: { total: out.length, ...count(out) }, decisions: { total: decisions.length, ...count(decisions) } };
writeFileSync("docs/preuves/tracabilite.json", JSON.stringify({ totals, cahier: out, decisions }, null, 1));

const link = (file) => `[${file.split("/").pop()}](${file.replace("docs/preuves/", "")})`;
const table = (list, extra) => ["| Id | § | Exigence | Résultat | Scénario exécuté | Preuve |", "| --- | --- | --- | --- | --- | --- |",
  ...list.map(item => `| ${item.id} | ${item.section ?? item.ref} | ${item.text.replace(/\|/g, "/")} | **${item.verdict}** | ${item.scenario.replace(/\|/g, "/").replace(/\n/g, " ").slice(0, 600)}${item.reason && item.verdict !== "FONCTIONNE" ? ` — *${item.reason.replace(/\|/g, "/").slice(0, 300)}*` : ""} | ${[...item.tests.map(t => `\`${t.file.split("/").pop()}\` ${t.passed}/${t.total}`), ...item.captures.map(link)].join("<br>") || "—"} |`)].join("\n");
const md = `# Traçabilité : 127 lignes du cahier et 20 décisions du 18/11

Généré par \`docs/preuves/outils/tracabilite.mjs\` à partir de l'exécution réelle (tests : \`tests-resultats.json\`, captures : \`captures/manifeste.json\`, contrôles : \`scenarios-resultats.json\`). **Les totaux sont calculés par le script, jamais saisis.**

Règles : FONCTIONNE = au moins un test exécuté et réussi **ou** un scénario exécuté, avec lien. Les lignes dont l'effet réel se produit dans Discord sont **NON TESTABLE EN LOCAL** : les tests à clients Discord simulés restent cités comme preuve de logique, pas d'effet. PARTIEL = le cahier la déclare partielle, la partie livrée est prouvée. NE FONCTIONNE PAS = absente ou test en échec.

## Totaux

| | Total | FONCTIONNE | PARTIEL | NE FONCTIONNE PAS | NON TESTABLE EN LOCAL |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cahier (lignes) | ${totals.cahier.total} | ${totals.cahier["FONCTIONNE"]} | ${totals.cahier["PARTIEL"]} | ${totals.cahier["NE FONCTIONNE PAS"]} | ${totals.cahier["NON TESTABLE EN LOCAL"]} |
| Décisions du 18/11 | ${totals.decisions.total} | ${totals.decisions["FONCTIONNE"]} | ${totals.decisions["PARTIEL"]} | ${totals.decisions["NE FONCTIONNE PAS"]} | ${totals.decisions["NON TESTABLE EN LOCAL"]} |

## Les 20 décisions du 18/11

Le dépôt ne les numérote pas : découpage atomique de \`docs/DECISIONS_TOWER.md\` (décisions du 18/11) et du §27 du cahier.

${table(decisions)}

## Les 127 lignes du cahier

${table(out)}
`;
writeFileSync("docs/preuves/TRACABILITE.md", md);
console.log(JSON.stringify(totals));
