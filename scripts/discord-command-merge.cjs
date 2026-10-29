function mergeManagedCommands(existing, requested) {
  if (!Array.isArray(existing) || !Array.isArray(requested)) {
    throw new Error("Discord command lists must be arrays");
  }

  const key = (command) => `${command.type ?? 1}:${command.name}`;
  for (const [label, commands] of [["existing", existing], ["requested", requested]]) {
    const keys = commands.map((command) => command?.name && key(command));
    if (keys.some((value) => !value) || new Set(keys).size !== keys.length) {
      throw new Error(`Discord ${label} commands must have unique names per command type`);
    }
  }

  const managedKeys = new Set(requested.map(key));
  return [...existing.filter((command) => !managedKeys.has(key(command))), ...requested];
}

module.exports = mergeManagedCommands;

