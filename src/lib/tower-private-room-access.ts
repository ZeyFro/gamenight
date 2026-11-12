export interface Room {
  guildId: string;
  teamId: string;
  kind: "text" | "voice";
}

export interface Membership {
  guildId: string;
  teamId: string;
  active: boolean;
}

export interface Viewer {
  guildId: string;
  canModeratePrivateRooms: boolean;
  memberships: readonly Membership[];
}

export function canAccessPrivateTowerRoom(
  room: Room,
  viewer: Viewer | null
): boolean {
  if (viewer === null) {
    return false;
  }

  if (room.guildId === "" || room.teamId === "") {
    return false;
  }

  if (room.guildId !== room.guildId.trim() || room.teamId !== room.teamId.trim()) {
    return false;
  }

  if (viewer.guildId !== room.guildId) {
    return false;
  }

  if (viewer.canModeratePrivateRooms === true) {
    return true;
  }

  return viewer.memberships.some(
    (m) => m.active === true && m.guildId === room.guildId && m.teamId === room.teamId
  );
}
