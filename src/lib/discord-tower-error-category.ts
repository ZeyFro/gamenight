const ALLOWED = new Set([
  "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError",
  "ZodError", "PrismaClientKnownRequestError", "PrismaClientValidationError",
  "PrismaClientInitializationError",
]);

/** Only stable error categories. Never log a raw Discord response or exception. */
export function safeTowerErrorCategory(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownTowerError";
  const name = (error as { name?: unknown }).name;
  if (typeof name === "string" && ALLOWED.has(name)) return name;
  return "UnknownTowerError";
}
