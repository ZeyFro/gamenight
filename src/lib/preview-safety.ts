/**
 * Safety invariant: a Vercel Preview cannot invoke scheduled jobs or issue
 * outbound Discord writes. Never depend only on feature flags for isolation.
 * The production/local paths retain their previous behaviour.
 */
export function isVercelPreview(): boolean {
  return process.env.VERCEL_ENV === "preview";
}
