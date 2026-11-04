/** Categorise Auth.js errors without recording tokens, URLs, user IDs, or raw errors. */
const KNOWN_AUTH_TYPES = new Set([
  "CallbackRouteError", "OAuthCallbackError", "OAuthProfileParseError",
  "AccessDenied", "Configuration", "MissingSecret", "InvalidCheck",
  "JWTSessionError", "SessionTokenError", "UnknownAction", "UntrustedHost",
  "OAuthSignInError", "OAuthAccountNotLinked", "CredentialsSignin",
  "MissingCSRF", "InvalidCallbackUrl", "AdapterError", "ErrorPageLoop",
  "EventError", "InvalidEndpoints", "MissingAdapter", "MissingAdapterMethods",
  "MissingAuthorize", "SignOutError", "UnsupportedStrategy", "InvalidProvider",
  "Verification", "DuplicateConditionalUI", "MissingWebAuthnAutocomplete",
  "WebAuthnVerificationError", "ExperimentalFeatureNotEnabled", "EmailSignInError",
  "AccountNotLinked",
]);

export function safeAuthErrorType(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownAuthError";
  // Auth.js .type remains meaningful in production builds; .name may be minified.
  const type = (error as { type?: unknown }).type;
  return typeof type === "string" && KNOWN_AUTH_TYPES.has(type) ? type : "UnknownAuthError";
}

/** Auth.js wraps its original error under cause.err. Never log raw cause,
 * name, message, stack, account data or URL. Only allow known stable types.
 */
export function safeAuthCauseType(error: unknown): string {
  if (!error || typeof error !== "object") return "UnknownAuthCause";
  const cause = (error as { cause?: unknown }).cause;
  if (!cause || typeof cause !== "object") return "UnknownAuthCause";
  const inner = "err" in cause ? (cause as { err?: unknown }).err : cause;
  if (!inner || typeof inner !== "object") return "UnknownAuthCause";
  const type = (inner as { type?: unknown }).type;
  if (typeof type === "string" && KNOWN_AUTH_TYPES.has(type)) return type;
  const name = (inner as { name?: unknown }).name;
  // Generic built-in error names only, never a custom exception name.
  if (name === "TypeError" || name === "SyntaxError" || name === "RangeError" ||
      name === "AbortError" || name === "TimeoutError") return name;
  return "UnknownAuthCause";
}
