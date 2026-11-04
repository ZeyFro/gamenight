/**
 * No deletion API call exists in this script. Default mode is OFFLINE.
 * --check performs only two GET requests and outputs a dry-run inventory.
 */
import { inspectEtageRoles } from "./tower-etage-role-rules.mjs";
const GUILD = "553922938101825536";
if (!process.argv.includes("--check")) {
  console.log("DRY-RUN hors ligne : aucune requête Discord. Utiliser --check pour inventaire GET uniquement.");
  process.exit(0);
}
const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error("Jeton Discord absent dans l'environnement autorisé ; aucun appel.");
  process.exit(1);
}
async function fetchJson(path) {
  const res = await fetch(`https://discord.com/api/v10/guilds/${GUILD}/${path}`, {
    method: "GET", headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Discord HTTP ${res.status} sur GET ${path}`);
  return res.json();
}
try {
  const [roles, channels] = await Promise.all([fetchJson("roles"), fetchJson("channels")]);
  if (!Array.isArray(roles) || !Array.isArray(channels)) throw new Error("Réponse Discord inattendue");
  const findings = inspectEtageRoles(roles, channels);
  console.log(JSON.stringify({
    mode: "read-only", guildId: GUILD, candidates: findings.length,
    expectedReported: 134, countMatchesReported: findings.length === 134,
    roles: findings, caveats: [
      "Attributions aux membres non interrogées ; vérifier aussi les bots tiers et automatisations Atlas.",
      "Tout rôle reste marqué safeToDelete=false : dépendances partielles seulement.",
      "Aucune suppression n'est implémentée dans ce script."
    ],
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Erreur d'inventaire");
  process.exitCode = 1;
}
