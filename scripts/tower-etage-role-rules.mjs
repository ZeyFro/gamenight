export function isLegacyEtageRole(name) {
  return /^(?:[\p{Emoji_Presentation}\p{Extended_Pictographic}\s·|\-]*)(?:étage|etage|floor)\s*[#:\-–]?\s*\d{1,4}(?:\b|$)/iu.test(name || "");
}
export function inspectEtageRoles(roles, channels) {
  const candidates = roles.filter(role => isLegacyEtageRole(role.name));
  return candidates.map(role => {
    const dependentChannels = channels.filter(ch =>
      (ch.permission_overwrites || []).some(override => override.type === 0 && override.id === role.id)
    ).map(ch => ({ id: ch.id, name: ch.name }));
    const permissions = BigInt(role.permissions || "0");
    return {
      id: role.id, name: role.name, managed: Boolean(role.managed),
      assignedMembers: "non vérifié (intents Discord requis)",
      hasGuildPermissions: permissions !== BigInt(0),
      dependentChannels,
      safeToDelete: false,
    };
  });
}
