import { describe, expect, it } from "vitest";
import { safeAuthErrorType, safeAuthCauseType } from "./safe-auth-error-type";

describe("safeAuthErrorType", () => {
  it("uses stable Auth.js type instead of potentially minified name", () => {
    expect(safeAuthErrorType({ name: "m", type: "CallbackRouteError" })).toBe("CallbackRouteError");
  });
  it("does not echo an unknown error type, tokens or callback URL", () => {
    const sensitive = "token=not-for-logs";
    const result = safeAuthErrorType({ name: "m", type: sensitive, message: sensitive });
    expect(result).toBe("UnknownAuthError");
    expect(result).not.toContain(sensitive);
  });
  it("handles absent or malformed errors", () => {
    expect(safeAuthErrorType(null)).toBe("UnknownAuthError");
    expect(safeAuthErrorType({ type: 4 })).toBe("UnknownAuthError");
  });
});

describe("safeAuthCauseType", () => {
  it("reads the allowlisted nested Auth.js type from cause.err", () => {
    expect(safeAuthCauseType({ type: "CallbackRouteError", cause: { err: { type: "InvalidCallbackUrl", name: "m" } } }))
      .toBe("InvalidCallbackUrl");
  });
  it("reads only the generic class of a JS error", () => {
    expect(safeAuthCauseType({ cause: { err: new TypeError("private token email") } })).toBe("TypeError");
  });
  it("never emits messages, secrets or custom names", () => {
    expect(safeAuthCauseType({ cause: { err: { name: "TokenLeak", type: "secret", message: "x@y.fr cookie" } } }))
      .toBe("UnknownAuthCause");
    expect(safeAuthCauseType({ cause: null })).toBe("UnknownAuthCause");
  });
});
