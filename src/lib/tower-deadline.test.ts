import { afterEach, expect, it, vi } from "vitest";
import { towerTransactionBudget } from "./tower-deadline";
afterEach(() => vi.restoreAllMocks());
it("conserve les budgets des appels interactifs sans échéance", () => {
  expect(towerTransactionBudget(undefined)).toEqual({ timeout: 15000, maxWait: 10000 });
});
it("réserve attente et transaction à l'intérieur du temps restant", () => {
  vi.spyOn(Date, "now").mockReturnValue(1000);
  const budget = towerTransactionBudget(new Date(1300));
  expect(budget.maxWait).toBeGreaterThan(0);
  expect(budget.timeout).toBeGreaterThan(0);
  expect(budget.maxWait + budget.timeout).toBeLessThan(300);
});
it.each([new Date(0), new Date(NaN)])("refuse un budget expiré ou invalide", deadline => {
  expect(() => towerTransactionBudget(deadline)).toThrow("tower_budget_exhausted");
});
