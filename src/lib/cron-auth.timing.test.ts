import { describe, expect, it } from "vitest";
import { checkCronAuth } from "@/lib/cron-auth";

/**
 * La comparaison est à temps constant (hash + `timingSafeEqual`, qui LÈVE
 * si les longueurs diffèrent). Un temps de réponse ne se teste pas de façon
 * fiable : ce fichier fige l'invariant observable — quelle que soit la
 * forme de l'en-tête, jamais d'exception, toujours 401 sauf valeur exacte.
 */
describe("checkCronAuth — en-têtes de forme quelconque", () => {
  it.each([
    "Bearer s3cret-et-plus",
    "Bearer s3cre",
    "Bearer é",
    "Bearer s3creT",
    "bearer s3cret",
    " Bearer s3cret",
    "",
    "x".repeat(10_000),
  ])("%j → 401 sans lever", (header) => {
    expect(checkCronAuth("s3cret", header)).toEqual({ ok: false, status: 401 });
  });

  it("valeur exacte → autorise", () => {
    expect(checkCronAuth("s3cret", "Bearer s3cret")).toEqual({ ok: true });
  });
});
