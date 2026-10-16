export interface CommunityDateInput {
  id: string;
  title: string | null;
  kind: "BIRTHDAY" | "IMPORTANT";
  date: Date;
  repeatsAnnually: boolean;
  createdById: string;
  member: { discordName: string } | null;
}

export interface CalendarCommunityDate {
  id: string;
  title: string;
  kind: "BIRTHDAY" | "IMPORTANT";
  date: Date;
  createdById: string;
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
