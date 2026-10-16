export interface IcalSession {
  id: string;
  date: Date;
  title: string;
  status: "VOTING" | "SCHEDULED";
  url: string;
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\r\n|\r|\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  const chunks: string[] = [];
  const encoder = new TextEncoder();
  let chunk = "";
  let bytes = 0;
  for (const character of line) {
    const length = encoder.encode(character).length;
    if (bytes + length > 75) {
      chunks.push(chunk);
      chunk = ` ${character}`;
      bytes = 1 + length;
    } else {
      chunk += character;
      bytes += length;
    }
  }
  chunks.push(chunk);
  return chunks.join("\r\n");
}

function localDateTime(date: Date): string {
  // Session dates are Europe/Paris wall-clock values encoded in UTC fields; do not shift them here.
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
}

function utcDateTime(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

const PARIS_TIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Paris",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19960331T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19961027T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

export function buildIcalCalendar(sessions: IcalSession[], now = new Date()): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GameNight//Calendrier//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:GameNight",
    "X-WR-TIMEZONE:Europe/Paris",
    ...PARIS_TIMEZONE,
    ...sessions.flatMap((session) => [
      "BEGIN:VEVENT",
      `UID:${escapeText(`${session.id}@gamenight`)}`,
      `DTSTAMP:${utcDateTime(now)}`,
      `DTSTART;TZID=Europe/Paris:${localDateTime(session.date)}`,
      `SUMMARY:${escapeText(session.title)}`,
      `STATUS:${session.status === "SCHEDULED" ? "CONFIRMED" : "TENTATIVE"}`,
      `URL:${escapeText(session.url)}`,
      "END:VEVENT",
    ]),
    "END:VCALENDAR",
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
