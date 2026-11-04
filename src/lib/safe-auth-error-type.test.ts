import { describe, expect, it } from "vitest";
import { safeAuthErrorType } from "./safe-auth-error-type";

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
