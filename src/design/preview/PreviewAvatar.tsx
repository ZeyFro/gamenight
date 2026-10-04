import type { FriendStatus } from "./fake-data";

/** Pastille ronde avec initiale (pas d'image : rien à charger, rien d'externe). */

const HUES = [
  ["#7c3aed", "#c026d3"],
  ["#4f46e5", "#7c3aed"],
  ["#c026d3", "#9333ea"],
  ["#0e7490", "#7c3aed"],
  ["#b45309", "#be123c"],
] as const;

function pair(name: string): readonly [string, string] {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return HUES[hash % HUES.length];
}

export function PreviewAvatar({
  name,
  size = 40,
  status,
  ring = false,
}: {
  name: string;
  size?: number;
  status?: FriendStatus;
  ring?: boolean;
}) {
  const [from, to] = pair(name);
  return (
    <span
      className="gn-pv-avatar"
      data-ring={ring ? "true" : "false"}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42), background: `linear-gradient(135deg, ${from}, ${to})` }}
      role="img"
      aria-label={name}
    >
      {name.charAt(0)}
      {status ? <span className="gn-pv-dot" data-status={status} aria-hidden="true" /> : null}
    </span>
  );
}
