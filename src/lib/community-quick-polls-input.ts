import { z } from "zod";

const inputSchema = z.object({
  question: z.string().trim().min(1).max(200),
  options: z.array(z.string().trim().min(1).max(80)).min(2).max(6),
  durationMinutes: z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().min(1).max(10080)),
});

export function isCommunityQuickPollsEnabled(): boolean {
  return process.env.COMMUNITY_QUICK_POLLS_ENABLED === "true";
}

export function parseQuickPollInput(value: unknown) {
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success || new Set(parsed.data.options.map(option => option.toLocaleLowerCase("fr"))).size !== parsed.data.options.length) return null;
  return parsed.data;
}

export function parseQuickPollOption(value: unknown): number | null {
  return typeof value === "string" && /^[0-5]$/.test(value) ? Number(value) : null;
}

export function isQuickPollClosed(endsAt: Date, now: Date): boolean {
  return !Number.isFinite(endsAt.getTime()) || now.getTime() >= endsAt.getTime();
}

export function quickPollResults(options: string[], counts: { optionIndex: number; count: number }[]) {
  return options.map((label, index) => ({ label, count: counts.find(row => row.optionIndex === index)?.count ?? 0 }));
}
