// Génère docs/preuves/INDEX.md, RAPPORT.md et GALERIE.md à partir des résultats (totaux calculés, jamais saisis).
import { readFileSync, writeFileSync } from "node:fs";
const t = JSON.parse(readFileSync("docs/preuves/tracabilite.json", "utf8"));
const tests = JSON.parse(readFileSync("docs/preuves/tests-resultats.json", "utf8")).results;
const caps = JSON.parse(readFileSync("docs/preuves/captures/manifeste.json", "utf8")).filter(item => item.file);
const T = t.totals;
const skipped = Object.entries(tests).filter(([, r]) => r.skipped).map(([file, r]) => `${file} (${r.skipped})`);
const testTotal = Object.values(tests).reduce((a, r) => a + r.total, 0);
const testPassed = Object.values(tests).reduce((a, r) => a + r.passed, 0);
const rel = file => file.replace("docs/preuves/", "");
const nonTestable = t.cahier.filter(item => item.verdict === "NON TESTABLE EN LOCAL");
const byKind = { "sans livrable code": nonTestable.filter(item => item.doc === "sans livrable code").length, "reportée": nonTestable.filter(item => item.doc === "reportée").length };
byKind["effet réel dans Discord"] = nonTestable.length - byKind["sans livrable code"] - byKind["reportée"];

const effort = {
  "9.1": ["Ajouter un champ « preuve ancienne autorisée » à la définition d'un défi et le lire dans les règles de preuve", "0,5–1 j"],
  "11.2": ["Migration additive (logo, bannière, couleur) sur `CommunityTeam` + interface capitaine", "1–2 j"],
  "12.3": ["Suggestion de partenaires compatibles (niveau, jeux, créneaux) ; pour la ligne « visibilité » : appliquer `canViewPote` aux classements et soirées", "3–5 j ; 2–3 j"],
  "14.3": ["Classement d'équipes Tower (agrégat des étages des membres) et page", "2–3 j"],
  "22.2": ["Sans objet depuis la décision §7.2 (compteur à zéro) : retirer la ligne du cahier", "0 j"],
  "8.5": ["Relecture humaine de la variété du catalogue de 116 défis", "0,5 j"],
  "10.3": ["Récapitulatif hebdomadaire Tower et mise en avant des joueurs actifs", "2–3 j"],
  "12.2": ["Champs langue et habitudes de jeu sur le profil et dans les filtres", "1–2 j"],
  "13.4": ["Brancher `notifyGamePingOptIns` dans les flux (voir D09)", "1–2 j"],
  "19.1": ["Journal général des opérations sensibles", "2–3 j"],
  "21.4": ["Preuve de restauration (action propriétaire sur Neon)", "0,5–1 j"],
  "27 I": ["Brancher les pings de rôle opt-in et la politique de MP (voir D08 à D10)", "2–4 j"],
};
const rowsFor = verdict => t.cahier.filter(item => item.verdict === verdict).map(item => `| ${item.id} | ${item.section} | ${item.text.replace(/\|/g, "/")} | ${(effort[item.section] ?? ["—", "—"])[0]} | ${(effort[item.section] ?? ["—", "—"])[1]} |`).join("\n");
const decisionFix = { D08: ["Appeler `isDirectMessageAllowed` à l'enqueue ; supprimer ou justifier les MP hors liste (« Bienvenue », rappels) ; décider avec le propriétaire du double ping #116 ; décocher « Prévenir qui » par défaut", "1–2 j"], D09: ["Appeler `notifyGamePingOptIns` / `buildGameRolePing` depuis les annonces de tournoi public et de jeux gratuits ; écran d'opt-in par jeu", "1–2 j"], D10: ["Filtrer `announceLevelUp` et `announceBadgeUnlocked` (nouveau Ranker/High Ranker, victoire de tournoi, record) et retirer la mention `<@id>`", "1 j"] };
const decisionRows = verdict => t.decisions.filter(item => item.verdict === verdict).map(item => `| ${item.id} | ${item.text} | ${(decisionFix[item.id] ?? ["—", "—"])[0]} | ${(decisionFix[item.id] ?? ["—", "—"])[1]} |`).join("\n");

const frictions = [
  ["« Jouer maintenant » prévient les 31 membres par défaut", "Les 31 cases « Prévenir qui ? » sont cochées ; un seul « Démarrer » met en file 31 MP + 1 annonce (mesuré en base). Le texte d'avertissement est sous 31 lignes.", "[D-3](parcours/D-bureau-03.png) · [D-5](parcours/D-bureau-05.png)", "Décocher par défaut, plafonner, afficher l'avertissement au-dessus de la liste", "0,5 j"],
  ["Premier défi Tower impossible dans l'application", "« Aucun défi solo en cours. Choisis-en un avec /tower defi sur Discord. » Aucun bouton.", "[C-3](parcours/C-bureau-03.png)", "Bouton « Obtenir mon défi » qui appelle la même action", "1–2 j"],
  ["Deux « Étage 1 » pour un joueur à 0 XP", "Étage d'Ascension (XP) et étages remportés par les défis s'affichent côte à côte, tous deux « Étage 1 ».", "[C-3](parcours/C-bureau-03.png)", "Renommer (« Niveau XP » / « Étages Tower »), afficher 0 pour un compteur vide", "0,5–1 j"],
  ["Vocabulaire jamais défini", "« Victime · Bronze » (13 pages), Régulars/Irregular, étage XP, rang, Lore, tierlist, Ascension : aucune définition dans le parcours.", "[PARCOURS_NOUVEAU §3](PARCOURS_NOUVEAU.md)", "Glossaire dans `/guide` + infobulles", "1 j"],
  ["Pages sans lien ou enfouies", "`/projets`, `/soutiens`, `/bibliotheque/plateformes` : aucun lien entrant ; `/ce-soir` à 3 clics ; `/notifications` seulement par la cloche.", "[graphe-clics.json](graphe-clics.json)", "Ajouter au menu ou à l'accueil", "0,5 j"],
  ["Libellés qui ne font pas ce qu'ils disent", "« Trouver des joueurs » ouvre les Forums Tower ; « Rejoindre une soirée » ouvre le formulaire de création.", "[B-3](parcours/B-bureau-03.png) · [A2-3](parcours/A2-bureau-03.png)", "Corriger les cibles et les libellés", "0,5 j"],
  ["Bouton Démarrer grisé sans raison affichée", "Aucun message tant qu'aucun jeu n'est choisi.", "[D-3](parcours/D-bureau-03.png)", "Texte d'aide « Choisis un jeu »", "0,25 j"],
  ["Redirections silencieuses", "`/admin` et `/serveurs` renvoient à l'accueil sans un mot pour un non-admin.", "[nouveau /admin](captures/nouveau-bureau-admin.png)", "Message « Réservé aux administrateurs »", "0,5 j"],
  ["Invite d'accueil et bouton flottant qui masquent le contenu", "Quatre boutons sur la première invite ; « Compléter mon profil » recouvre le bas de page sur plusieurs captures.", "[accueil](captures/nouveau-bureau-accueil.png) · [D-5](parcours/D-bureau-05.png)", "Un seul bouton principal ; décaler le bouton flottant", "0,5 j"],
  ["Annonces et MP au-delà de la décision du 18/11", "Chaque niveau et chaque badge annoncés avec mention ; MP « Bienvenue » au premier rendu (code lu, non exécuté faute de jeton).", "[NOTIFICATIONS.md](NOTIFICATIONS.md)", "Voir D08 et D10", "1–2 j"],
];

writeFileSync("docs/preuves/RAPPORT.md", `# Rapport : preuves et audit du parcours du nouveau joueur

Local uniquement (PostgreSQL jetable 127.0.0.1, aucun appel Discord, Vercel ni Neon, aucune correction de code). Chiffres calculés par \`outils/tracabilite.mjs\`.

## 1. Totaux

| | Total | FONCTIONNE | PARTIEL | NE FONCTIONNE PAS | NON TESTABLE EN LOCAL |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Lignes du cahier** | ${T.cahier.total} | ${T.cahier["FONCTIONNE"]} | ${T.cahier["PARTIEL"]} | ${T.cahier["NE FONCTIONNE PAS"]} | ${T.cahier["NON TESTABLE EN LOCAL"]} |
| **Décisions du 18/11** | ${T.decisions.total} | ${T.decisions["FONCTIONNE"]} | ${T.decisions["PARTIEL"]} | ${T.decisions["NE FONCTIONNE PAS"]} | ${T.decisions["NON TESTABLE EN LOCAL"]} |

Les ${T.cahier["NON TESTABLE EN LOCAL"]} lignes « non testables » : ${byKind["sans livrable code"]} sans livrable code (principes, actions humaines), ${byKind["reportée"]} reportées par décision, ${byKind["effet réel dans Discord"]} dont l'effet se produit dans Discord (tests à clients simulés réussis, mais l'effet réel n'est pas observable sans appel Discord). **Les décisions comptent 20 lignes : le dépôt ne les numérote pas, j'ai découpé \`docs/DECISIONS_TOWER.md\` (décisions du 18/11) et le §27 du cahier en 20 décisions atomiques** (liste dans [TRACABILITE.md](TRACABILITE.md)).

**Exécution des tests cités : ${Object.keys(tests).length} fichiers, ${testPassed}/${testTotal} tests réussis.** Tests ignorés (« skipped »), à signaler : ${skipped.join(" ; ") || "aucun"}. Un premier essai a échoué sur \`src/app/tower/forums/page.test.tsx\` (« Invalid hook call ») à cause de ma copie locale de \`node_modules\` en liens physiques ; réexécuté avec le \`node_modules\` normal : 2/2 réussis. Ce n'est pas un défaut du code.

## 2. NE FONCTIONNE PAS

| Id | § | Exigence | Correction proposée | Effort (estimation de développement, non mesurée) |
| --- | --- | --- | --- | --- |
${rowsFor("NE FONCTIONNE PAS")}

Décisions du 18/11 :

| Id | Décision | Correction proposée | Effort |
| --- | --- | --- | --- |
${decisionRows("NE FONCTIONNE PAS")}

## 3. PARTIEL

| Id | § | Exigence | Correction proposée | Effort (estimation) |
| --- | --- | --- | --- | --- |
${rowsFor("PARTIEL")}

Décisions du 18/11 :

| Id | Décision | Correction proposée | Effort |
| --- | --- | --- | --- |
${decisionRows("PARTIEL")}

## 4. Les 10 premières frictions d'un débutant (classées)

| # | Friction | Preuve mesurée | Capture | Correction | Effort |
| ---: | --- | --- | --- | --- | --- |
${frictions.map((f, i) => `| ${i + 1} | **${f[0]}** | ${f[1]} | ${f[2]} | ${f[3]} | ${f[4]} |`).join("\n")}

Détail des clics, des culs-de-sac et du jargon : [PARCOURS_NOUVEAU.md](PARCOURS_NOUVEAU.md).

## 5. Pings et notifications (résumé ; détail dans [NOTIFICATIONS.md](NOTIFICATIONS.md))

Vérifié par moi : aucun \`@everyone\` ni \`@here\` n'est émis (suppression de \`parse=everyone\` dans \`src/lib/discord-rest.ts\`) ; **\`buildGameRolePing\`, \`notifyGamePingOptIns\`, \`isDirectMessageAllowed\`, \`isPublicAnnouncementAllowed\` ont zéro appelant hors tests** (grep exécuté) : l'opt-in des pings de rôle est du code mort et la politique « MP seulement ciblés » n'est pas appliquée ; chaque niveau et badge sont annoncés avec \`<@id>\` (\`discord-level-up.ts:33\`, \`discord-badge-unlocked.ts:26\`). Lu dans le code par l'audit (non exécuté) : 25 livraisons par passage de l'executor, aucun plafond sur la liste des invités notifiés, un 429 consomme une tentative sur 8 ; à 100 invités une annonce de soirée dépasse probablement la limite de 2 000 caractères de Discord (chiffre non vérifiable en local).

## 6. Ce qui n'a pas pu être fait

- Connexion Discord réelle (OAuth), toute action dans Discord, Steam, IGDB, crons externes : non testables en local.
- Mobile : captures de toutes les pages ; parcours interactifs mobiles seulement jusqu'à la 3ᵉ étape (profil de test déjà modifié par les parcours bureau).
- Serveur en mode développement : pastille « N » visible sur certaines captures ; les performances mesurées ne sont pas celles de la production.

## 7. Reproduire

\`\`\`bash
npm ci   # ou lien vers un node_modules existant
DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_preuves npx prisma migrate deploy
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_preuves node docs/preuves/outils/seed.mjs
docs/preuves/outils/lancer-serveur.sh &
TEST_DATABASE_URL=postgresql://postgres:test@127.0.0.1:55439/gamenight_preuves node docs/preuves/outils/capture.mjs
node docs/preuves/outils/tests.mjs && node docs/preuves/outils/scenarios.mjs && node docs/preuves/outils/tracabilite.mjs
\`\`\`
`);

const hero = [["Visiteur (non connecté), bureau", "captures/visiteur-bureau-accueil.png"], ["Nouveau joueur, mobile : première invite", "captures/nouveau-mobile-accueil.png"], ["Nouveau joueur, bureau : accueil", "captures/nouveau-bureau-accueil.png"], ["Nouveau joueur : The Tower (deux « Étage 1 »)", "parcours/C-bureau-03.png"], ["« Jouer maintenant » : 31 potes cochés par défaut", "parcours/D-bureau-03.png"], ["Joueur actif, bureau : accueil", "captures/actif-bureau-accueil.png"], ["Administrateur : tableau de bord v2", "captures/admin-bureau-admin_tableau-de-bord.png"]];
writeFileSync("docs/preuves/INDEX.md", `# Preuves : captures et parcours du nouveau joueur

Branche \`preuves/20261121\`, **Draft, jamais fusionnée**. Application lancée en local (PostgreSQL jetable, tous les \`*_ENABLED\` à \`true\`, aucune clé externe, aucun appel Discord/Vercel/Neon), avec 1 communauté, 31 membres actifs, 3 équipes, 5 soirées, 2 tournois, 5 défis et 1 booster ; trois profils simulés : nouveau joueur sans donnée, joueur actif, administrateur. Aucune correction de code dans cette PR.

## Résultat en une table

| | Total | FONCTIONNE | PARTIEL | NE FONCTIONNE PAS | NON TESTABLE EN LOCAL |
| --- | ---: | ---: | ---: | ---: | ---: |
| Lignes du cahier | ${T.cahier.total} | ${T.cahier["FONCTIONNE"]} | ${T.cahier["PARTIEL"]} | ${T.cahier["NE FONCTIONNE PAS"]} | ${T.cahier["NON TESTABLE EN LOCAL"]} |
| Décisions du 18/11 | ${T.decisions.total} | ${T.decisions["FONCTIONNE"]} | ${T.decisions["PARTIEL"]} | ${T.decisions["NE FONCTIONNE PAS"]} | ${T.decisions["NON TESTABLE EN LOCAL"]} |

Aucun FONCTIONNE sans preuve exécutée (test réussi ou scénario). ${Object.keys(tests).length} fichiers de test exécutés : ${testPassed}/${testTotal} tests réussis. ${caps.length} captures PNG (mobile 375 px et bureau 1280 px, chacune sous 300 ko).

## Documents

| Document | Contenu |
| --- | --- |
| [RAPPORT.md](RAPPORT.md) | Totaux, NE FONCTIONNE PAS et PARTIEL avec correction et effort, 10 frictions classées |
| [TRACABILITE.md](TRACABILITE.md) | Les 127 lignes du cahier et les 20 décisions : scénario exécuté, résultat, lien vers le test ou la capture |
| [PARCOURS_NOUVEAU.md](PARCOURS_NOUVEAU.md) | Clics, écrans, culs-de-sac, jargon (« étage », « grade », « rang », « Tower », « GameNight »), verdict « le débutant est-il perdu ? » |
| [NOTIFICATIONS.md](NOTIFICATIONS.md) | Pings, MP, limites de fréquence, 100 joueurs, tous les cas de mention |
| [GALERIE.md](GALERIE.md) | Toutes les captures par page, mobile et bureau |
| [outils/](outils) | Scripts de peuplement, de capture, de tests et de traçabilité |

## Aperçu

${hero.map(([title, file]) => `**${title}**\n\n![${title}](${file})\n`).join("\n")}
`);

const groups = new Map();
for (const item of caps) { const key = item.path.replace(/[a-z0-9]{20,}/g, ":id"); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
const lines = ["# Galerie : toutes les captures", "", `${caps.length} captures locales (profils : visiteur, nouveau, actif, admin). Statut HTTP et erreurs de console dans [captures/manifeste.json](captures/manifeste.json).`, ""];
for (const [path, items] of [...groups.entries()].sort()) {
  lines.push(`## \`${path}\``, "", "| Profil | Mobile 375 px | Bureau 1280 px | HTTP |", "| --- | --- | --- | ---: |");
  for (const persona of ["visiteur", "nouveau", "actif", "admin"]) {
    const m = items.find(i => i.persona === persona && i.viewport === "mobile"); const d = items.find(i => i.persona === persona && i.viewport === "bureau");
    if (!m && !d) continue;
    lines.push(`| ${persona}${(d ?? m).finalPath !== (d ?? m).path ? ` → \`${(d ?? m).finalPath}\`` : ""} | ${m ? `<img src="${rel(m.file)}" width="160">` : ""} | ${d ? `<img src="${rel(d.file)}" width="420">` : ""} | ${(d ?? m).status} |`);
  }
  lines.push("");
}
writeFileSync("docs/preuves/GALERIE.md", lines.join("\n"));
console.log("INDEX, RAPPORT, GALERIE générés ;", caps.length, "captures ;", groups.size, "pages");
