import { expect, it } from "vitest";

type Room = { guildId: string; teamId: string; kind: "text" | "voice" };
type Viewer = { guildId: string; canModeratePrivateRooms: boolean;
  memberships: { guildId: string; teamId: string; active: boolean }[] };
const files = import.meta.glob("./tower-private-room-access.ts", { eager: true });
function access() {
  const feature = files["./tower-private-room-access.ts"] as {
    canAccessPrivateTowerRoom: (room: Room, viewer: Viewer | null) => boolean;
  } | undefined;
  expect(feature?.canAccessPrivateTowerRoom).toBeTypeOf("function");
  return feature!.canAccessPrivateTowerRoom;
}
const team = { guildId: "tower", teamId: "paped", active: true };
const member = { guildId: "tower", canModeratePrivateRooms: false, memberships: [team] };
const textRoom: Room = { guildId: "tower", teamId: "paped", kind: "text" };

it.each(["text", "voice"] as const)("ouvre uniquement le salon %s à un membre actif", (kind) => {
  const room = { ...textRoom, kind };
  expect(access()(room, member)).toBe(true);
  expect(access()(room, { ...member, memberships: [{ ...team, active: false }] })).toBe(false);
  expect(access()(room, { ...member, memberships: [{ ...team, teamId: "autre" }] })).toBe(false);
  expect(access()(room, null)).toBe(false);
});

it("accepte le modérateur habilité du serveur et refuse celui d’un autre serveur", () => {
  const moderator = { guildId: "tower", canModeratePrivateRooms: true, memberships: [] };
  expect(access()(textRoom, moderator)).toBe(true);
  expect(access()(textRoom, { ...moderator, guildId: "another" })).toBe(false);
  expect(access()(textRoom, { ...moderator, canModeratePrivateRooms: false })).toBe(false);
});

it("refuse un autre serveur et des identifiants de salle incomplets", () => {
  expect(access()(textRoom, { ...member, memberships: [{ ...team, guildId: "another" }] })).toBe(false);
  expect(access()({ ...textRoom, teamId: " " }, member)).toBe(false);
  expect(access()({ ...textRoom, teamId: "paped " }, member)).toBe(false);
});
