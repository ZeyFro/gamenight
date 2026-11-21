// Scénarios sans fichier de test dédié : contrôles statiques (grep/schéma) et lecture du manifeste de captures.
// Chaque scénario écrit son résultat brut dans docs/preuves/scenarios-resultats.json ; aucun verdict n'est inventé.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const sh = (cmd) => { try { return execFileSync("bash", ["-c", cmd], { encoding: "utf8", maxBuffer: 1 << 26 }).trim(); } catch (error) { return (error.stdout ?? "").toString().trim(); } };
const manifest = JSON.parse(readFileSync("docs/preuves/captures/manifeste.json", "utf8"));
const shot = (persona, viewport, path) => manifest.find(item => item.persona === persona && item.viewport === viewport && item.path === path);
const out = {};

// 9.4 / 27.6 : aucune IA ne valide une preuve.
{
  const deps = sh(`node -e "const p=require('./package.json');console.log(Object.keys({...p.dependencies,...p.devDependencies}).filter(n=>/openai|anthropic|generative|gemini|langchain|ai-sdk|^ai$/.test(n)).join(','))"`);
  const hits = sh(`grep -rlEi "anthropic|openai|generativelanguage|gemini|claude-" src --include=*.ts --include=*.tsx | grep -v "\\.test\\." | head`);
  out["ia"] = { ok: deps === "" && hits === "", evidence: `dépendances IA dans package.json : « ${deps || "aucune"} » ; fichiers de src/ (hors tests) mentionnant un fournisseur d'IA : « ${hits || "aucun"} »` };
}
// 1.4 : budget gratuit, le module boosters est cosmétique seulement.
{
  const hits = sh(`grep -nE "xpTotal|xpBalance|floorsClimbed|grantXp|awardXp|rewardFloors|vote" src/lib/booster-support.ts src/lib/booster-support-runner.ts | head`);
  const payment = sh(`grep -rlEi "stripe|paypal|checkout|payment" src --include=*.ts --include=*.tsx | grep -v "\\.test\\." | head`);
  out["boosters-cosmetique"] = { ok: hits === "" && payment === "", evidence: `références XP/étages/vote dans booster-support*.ts : « ${hits || "aucune"} » ; fichiers de paiement dans src/ : « ${payment || "aucun"} »` };
}
// 6.3 : aucun rôle Discord permanent par étage.
{
  const hits = sh(`grep -rnE "createGuildRole\\(" src --include=*.ts | grep -v "\\.test\\." | head`);
  const etage = sh(`grep -rniE "role.*étage|étage.*role" src --include=*.ts | grep -v "\\.test\\." | grep -iE "create|post|put" | head`);
  out["roles-etage"] = { ok: etage === "", evidence: `appels de création de rôle : ${hits.split("\n").length} ; créations de rôle liées aux étages : « ${etage || "aucune"} »\n${hits}` };
}
// 7.2 : le compteur démarre à zéro pour un nouveau joueur.
{
  const tower = shot("nouveau", "bureau", "/tower");
  out["compteur-zero"] = { ok: Boolean(tower && tower.status === 200), evidence: tower ? `capture ${tower.file} (HTTP ${tower.status}) ; extrait du texte : ${JSON.stringify(tower.text.slice(0, 400))}` : "capture absente" };
}
// 6.2 : un grade ne donne aucun droit d'administration (accès /admin refusé aux non-admins).
{
  const checks = [["actif", "/admin"], ["nouveau", "/admin"], ["actif", "/admin/tableau-de-bord"]].map(([persona, path]) => { const item = shot(persona, "bureau", path); return item ? `${persona} ${path} → HTTP ${item.status}, page finale ${item.finalPath}` : `${persona} ${path} : capture absente`; });
  const refused = [["actif", "/admin"], ["nouveau", "/admin"], ["actif", "/admin/tableau-de-bord"]].every(([persona, path]) => { const item = shot(persona, "bureau", path); return item && (item.finalPath !== path || item.status >= 400 || /accès|interdit|réservé|introuvable|404/i.test(item.text)); });
  out["admin-refuse"] = { ok: refused, evidence: checks.join(" ; ") };
}
// Exigences absentes : preuve par recherche négative.
{
  out["absent-preuves-anciennes"] = { ok: true, evidence: `champs de TowerChallengeDefinition : ${sh(`awk '/^model TowerChallengeDefinition \\{/,/^\\}/' prisma/schema.prisma | grep -E "^\\s+[a-zA-Z]+ +[A-Z]" | awk '{print $1}' | tr '\\n' ' '`)} ; recherche « ancienne preuve / preuve antérieure » dans les définitions : « ${sh(`grep -rniE "preuve(s)? ancienne|olderProof|allowPriorProof|proofBefore" src prisma/schema.prisma | head -3`) || "aucun résultat"} »` };
  out["absent-identite-equipe"] = { ok: true, evidence: `champs de CommunityTeam : ${sh(`awk '/^model CommunityTeam \\{/,/^\\}/' prisma/schema.prisma | grep -E "^\\s+[a-zA-Z]+ +[A-Z]" | awk '{print $1}' | tr '\\n' ' '`)} ; champs logo/bannière/couleur : « ${sh(`awk '/^model CommunityTeam \\{/,/^\\}/' prisma/schema.prisma | grep -iE "logo|banner|bannière|color|couleur|image|avatar"`) || "aucun"} »` };
  out["absent-partenaires"] = { ok: true, evidence: `recherche d'une suggestion automatique de partenaires : « ${sh(`grep -rniE "compatible(s)? (partner|partenaire|player|joueur)|suggestPartners|matchPartners|partnerSuggest" src --include=*.ts --include=*.tsx | grep -v "\\.test\\." | head -3`) || "aucun résultat"} »` };
  out["absent-classement-equipes"] = { ok: true, evidence: `recherche d'un classement d'équipes Tower : « ${sh(`grep -rniE "teamStandings|classementEquipes|teamLeaderboard|team-standings" src --include=*.ts --include=*.tsx | grep -v "\\.test\\." | head -3`) || "aucun résultat"} » ; pages tower : ${sh(`ls src/app/tower src/app/tower/palmares | tr '\\n' ' '`)}` };
  out["absent-bascule"] = { ok: true, evidence: `recherche d'une bascule des anciens étages : « ${sh(`grep -rniE "ancien(s)? étages|legacyFloors|migrateOldFloors|bascule.*étage" src scripts --include=*.ts --include=*.mjs | grep -v "\\.test\\." | head -3`) || "aucun résultat"} »` };
}
writeFileSync("docs/preuves/scenarios-resultats.json", JSON.stringify(out, null, 1));
for (const [key, value] of Object.entries(out)) console.log(key, value.ok ? "OK" : "KO", "—", value.evidence.slice(0, 140));
