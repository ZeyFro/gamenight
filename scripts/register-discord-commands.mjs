// Ajoute/remplace uniquement les commandes Tower de l'application Discord.
// Par défaut : simulation (affiche le corps, n'appelle pas Discord).
//   node scripts/register-discord-commands.mjs            # simulation
//   node scripts/register-discord-commands.mjs --execute  # GET + PUT réel
// Le PUT Discord remplace toutes les commandes globales : le script conserve donc
// celles qui ne sont pas gérées par Tower et ne les supprime pas.
// Variables : DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN.
import { readFileSync } from "node:fs";
import mergeManagedCommands from "./discord-command-merge.cjs";

const commands = JSON.parse(readFileSync(new URL("./discord-commands.json", import.meta.url), "utf8"));

if (!process.argv.includes("--execute")) {
  console.log("Simulation uniquement. En mode réel, les autres commandes globales sont conservées :");
  console.log(JSON.stringify(commands, null, 2));
  process.exit(0);
}

const appId = process.env.DISCORD_CLIENT_ID?.trim();
const token = process.env.DISCORD_BOT_TOKEN?.trim();
if (!appId || !/^\d+$/.test(appId) || !token) {
  console.error("DISCORD_CLIENT_ID et DISCORD_BOT_TOKEN sont requis.");
  process.exit(1);
}

const endpoint = `https://discord.com/api/v10/applications/${appId}/commands`;
const headers = { Authorization: `Bot ${token}`, "Content-Type": "application/json" };
const currentResponse = await fetch(endpoint, { headers });
if (!currentResponse.ok) {
  console.error(`Lecture des commandes impossible (${currentResponse.status}); aucune écriture effectuée.`);
  process.exit(1);
}
const current = await currentResponse.json();
const merged = mergeManagedCommands(current, commands);
const response = await fetch(endpoint, {
  method: "PUT",
  headers,
  body: JSON.stringify(merged),
});
if (!response.ok) {
  console.error(`Échec ${response.status} : ${await response.text()}`);
  process.exit(1);
}
const registered = await response.json();
console.log(`Commandes enregistrées : ${registered.map((c) => c.name).join(", ")}`);

