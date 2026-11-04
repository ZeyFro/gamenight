/** Categorise Auth.js errors without recording tokens, URLs, user IDs, or raw errors. */
const KNOWN_AUTH_TYPES = new Set([
  "CallbackRouteError", "OAuthCallbackError", "OAuthProfileParseError",
  "AccessDenied", "Configuration", "MissingSecret", "InvalidCheck",
  "JWTSessionError", "SessionTokenError", "UnknownAction", "UntrustedHost",
  "OAuthSignInError", "OAuthAccountNotLinked", "CredentialsSignin",
]);

export function safeAuthErrorType(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownAuthError";
  // Auth.js .type remains meaningful in production builds; .name may be minified.
  const type = (error as { type?: unknown }).type;
  return typeof type === "string" && KNOWN_AUTH_TYPES.has(type) ? type : "UnknownAuthError";
}
