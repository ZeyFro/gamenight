import type { Prisma } from "@prisma/client";

export function towerTransactionBudget(deadline: Date | undefined, defaults = { timeout: 15000, maxWait: 10000 }) {
  if (!deadline) return defaults;
  const remaining = Math.floor(deadline.getTime() - Date.now());
  if (!Number.isFinite(remaining) || remaining < 5) throw new Error("tower_budget_exhausted");
  const maxWait = Math.min(defaults.maxWait, Math.max(1, Math.floor(remaining / 4)));
  return { maxWait, timeout: Math.min(defaults.timeout, remaining - maxWait - 2) };
}

/** Server-side cancellation too: a client-side Promise.race cannot stop a write. */
export async function setTowerStatementDeadline(tx: Prisma.TransactionClient, deadline?: Date) {
  if (!deadline) return;
  const remaining = Math.floor(deadline.getTime() - Date.now()) - 2;
  if (!Number.isFinite(remaining) || remaining < 1) throw new Error("tower_budget_exhausted");
  await tx.$queryRaw`SELECT set_config('statement_timeout', ${String(remaining)}, true)`;
}
