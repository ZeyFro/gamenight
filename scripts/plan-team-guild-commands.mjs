/** Offline preparation only: reads a supplied guild snapshot, never calls Discord. */
import { readFileSync } from "node:fs";
import mergeManagedCommands from "./discord-command-merge.cjs";

const snowflake = value => typeof value === "string" && /^[1-9]\d{16,19}$/.test(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const commandFields = new Set([
  "id", "application_id", "guild_id", "version", "type", "name", "name_localizations", "name_localized",
  "description", "description_localizations", "description_localized", "options", "default_member_permissions",
  "default_permission", "nsfw", "dm_permission", "integration_types", "contexts",
]);

try {
  const args = process.argv.slice(2);
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!["--application-id", "--guild-id", "--snapshot"].includes(key)
      || options.has(key) || !value || value.startsWith("--")) throw new Error();
    options.set(key, value);
  }
  const applicationId = options.get("--application-id");
  const guildId = options.get("--guild-id");
  if (options.size !== 3 || !snowflake(applicationId) || !snowflake(guildId)) throw new Error();
  const snapshot = JSON.parse(readFileSync(options.get("--snapshot"), "utf8"));
  if (!object(snapshot) || Object.keys(snapshot).some(key => !["application_id", "guild_id", "commands"].includes(key))
    || snapshot.application_id !== applicationId || snapshot.guild_id !== guildId || !Array.isArray(snapshot.commands)) throw new Error();
  for (const command of snapshot.commands) {
    if (!object(command) || Object.keys(command).some(key => !commandFields.has(key))
      || command.application_id !== applicationId || command.guild_id !== guildId || !snowflake(command.id)
      || ![1, 2, 3].includes(command.type) || typeof command.name !== "string" || !command.name
      || (command.default_member_permissions !== undefined && command.default_member_permissions !== null
        && !(typeof command.default_member_permissions === "string" && /^\d+$/.test(command.default_member_permissions)))
      || (command.default_permission !== undefined && typeof command.default_permission !== "boolean")
      || (command.nsfw !== undefined && typeof command.nsfw !== "boolean")) throw new Error();
  }
  const manifest = JSON.parse(readFileSync(new URL("./discord-commands.json", import.meta.url), "utf8"));
  const requested = manifest.filter(command => command.type === 1 && command.name === "equipe");
  if (requested.length !== 1) throw new Error();
  // Guild POST fields, deliberately excluding global-only contexts/integration_types.
  const { name, type, description, options: commandOptions, default_member_permissions } = requested[0];
  const payload = { name, type, description, options: commandOptions, default_member_permissions };
  const current = snapshot.commands.find(command => command.type === type && command.name === name);
  if (current) {
    // Never infer an existing command's authorization defaults or widen its restrictions.
    if (!Object.hasOwn(current, "default_member_permissions")) throw new Error();
    payload.default_member_permissions = current.default_member_permissions;
    for (const key of ["default_permission", "nsfw"]) {
      if (Object.hasOwn(current, key)) payload[key] = current[key];
    }
  }
  console.log(JSON.stringify({
    offline: true,
    method: "POST",
    route: `/applications/${applicationId}/guilds/${guildId}/commands`,
    payload,
    // Comparison view only, never a bulk PUT body: other commands remain untouched.
    plannedCommands: mergeManagedCommands(snapshot.commands, [payload]),
  }, null, 2));
} catch {
  console.error("Plan refusé : options, manifeste ou snapshot de serveur invalides. Aucune communication réseau.");
  process.exitCode = 1;
}
