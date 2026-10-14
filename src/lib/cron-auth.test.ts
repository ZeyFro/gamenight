import { describe, it, expect } from "vitest";
import { checkCronAuth } from "@/lib/cron-auth";

describe("checkCronAuth (fail-closed, PR Accès & secrets)", () => {
  it("secret absent de l'env : refuse (503, route désactivée)", () => {
    expect(checkCronAuth(undefined, "Bearer whatever")).toEqual({ ok: false, status: 503 });
    expect(checkCronAuth(undefined, null)).toEqual({ ok: false, status: 503 });
  });

  it("secret présent mais en-tête absent : refuse (401)", () => {
    expect(checkCronAuth("s3cret", null)).toEqual({ ok: false, status: 401 });
  });

  it("secret présent mais en-tête incorrect : refuse (401)", () => {
    expect(checkCronAuth("s3cret", "Bearer mauvais")).toEqual({ ok: false, status: 401 });
    expect(checkCronAuth("s3cret", "s3cret")).toEqual({ ok: false, status: 401 });
  });

  it("secret présent et en-tête correct : autorise", () => {
    expect(checkCronAuth("s3cret", "Bearer s3cret")).toEqual({ ok: true });
  });

  it("secret vide (chaîne vide) traité comme absent : refuse (503)", () => {
    expect(checkCronAuth("", "Bearer ")).toEqual({ ok: false, status: 503 });
  });
});
