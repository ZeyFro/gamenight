import { AsyncLocalStorage } from "node:async_hooks";

// Explicitement limité à un chargement de page. Aucun cache global de droits,
// aucune réutilisation dans les mutations ou les livraisons Discord.
const reads = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withCommunityReadContext<T>(read: () => Promise<T>): Promise<T> {
  return reads.run(new Map(), read);
}

export function communityRead<T>(key: string, read: () => Promise<T>): Promise<T> {
  const context = reads.getStore();
  if (!context) return read();
  const existing = context.get(key);
  if (existing) return existing as Promise<T>;
  const promise = read();
  context.set(key, promise);
  return promise;
}
