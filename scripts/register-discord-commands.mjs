// Enregistre les commandes GLOBALES de l'application Discord (scripts/discord-commands.json).
// Par défaut : simulation (affiche le corps, n'appelle pas Discord).
//   node scripts/register-discord-commands.mjs            # simulation
//   node scripts/register-discord-commands.mjs --execute  # PUT réel
// ⚠ Le PUT REMPLACE toutes les commandes globales de l'application : à n'exécuter
// qu'une fois l'endpoint d'interactions configuré, et jamais depuis un test.
// Variables : DISCORD_CLIENT_ID, DISCORD_BOT_TOKEN.
import { readFileSync } from "node:fs";

const commands = JSON.parse(readFileSync(new URL("./discord-commands.json", import.meta.url), "utf8"));

if (!process.argv.includes("--execute")) {
  console.log("Simulation (ajoute --execute pour enregistrer) :");
  console.log(JSON.stringify(commands, null, 2));
  process.exit(0);
}

const appId = process.env.DISCORD_CLIENT_ID?.trim();
const token = process.env.DISCORD_BOT_TOKEN?.trim();
if (!appId || !/^\d+$/.test(appId) || !token) {
  console.error("DISCORD_CLIENT_ID et DISCORD_BOT_TOKEN sont requis.");
  process.exit(1);
}

const response = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: "PUT",
  headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(commands),
});
if (!response.ok) {
  console.error(`Échec ${response.status} : ${await response.text()}`);
  process.exit(1);
}
const registered = await response.json();
console.log(`Commandes enregistrées : ${registered.map((c) => c.name).join(", ")}`);
