export interface CommunityDateInput {
  id: string;
  title: string | null;
  kind: "BIRTHDAY" | "IMPORTANT" | "GAME_RELEASE";
  date: Date;
  repeatsAnnually: boolean;
  createdById: string;
  member: { discordName: string } | null;
}

export interface CalendarCommunityDate {
  id: string;
  title: string;
  kind: "BIRTHDAY" | "IMPORTANT" | "GAME_RELEASE";
  date: Date;
  createdById: string;
  href?: string;
}

export function expandGameReleaseDates(rows: { id: string; gameId: string; title: string; createdById: string; igdbDetails: unknown }[], start: Date, endExclusive: Date): CalendarCommunityDate[] {
  return rows.flatMap((row) => {
    const releaseDate = row.igdbDetails && typeof row.igdbDetails === "object" && "releaseDate" in row.igdbDetails
      ? row.igdbDetails.releaseDate
      : null;
    if (typeof releaseDate !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(releaseDate)) return [];
    const instant = new Date(releaseDate);
    if (!Number.isFinite(instant.getTime())) return [];
    const date = new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth(), instant.getUTCDate()));
    if (date < start || date >= endExclusive) return [];
    return [{ id: `game-release:${row.id}`, title: `Sortie · ${row.title}`, kind: "GAME_RELEASE" as const, date, createdById: row.createdById, href: `/jeux/${row.gameId}` }];
  });
}

export function expandCommunityDates(rows: CommunityDateInput[], start: Date, endExclusive: Date): CalendarCommunityDate[] {
  const events: CalendarCommunityDate[] = [];
  for (const row of rows) {
    const title = row.kind === "BIRTHDAY" ? (row.member ? `Anniversaire · ${row.member.discordName}` : null) : row.title;
    if (!title) continue;
    const firstYear = row.repeatsAnnually ? start.getUTCFullYear() : row.date.getUTCFullYear();
    const lastYear = row.repeatsAnnually ? endExclusive.getUTCFullYear() : firstYear;
    for (let year = firstYear; year <= lastYear; year++) {
      const month = row.date.getUTCMonth();
      // Un anniversaire du 29 février est affiché le 28 les années non bissextiles.
      const day = Math.min(row.date.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
      const date = new Date(Date.UTC(year, month, day));
      if (date >= start && date < endExclusive) events.push({ id: row.id, title, kind: row.kind, date, createdById: row.createdById });
    }
  }
  return events;
}
