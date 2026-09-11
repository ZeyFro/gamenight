import { prisma } from "@/lib/prisma";
import { wallClockNow, endOfMonthUTC } from "@/lib/wallclock";

/**
 * Bootstrap de la Saison 1. Convertie depuis `prisma/seed-season.mjs` (PR
 * "build ne fait plus que compiler") : importe directement `wallClockNow`/
 * `endOfMonthUTC` de `@/lib/wallclock` au lieu de dupliquer une fonction
 * `endOfMonthUtc` locale sur `new Date()` (UTC serveur brut) — l'ancienne
 * version Node/ESM autonome ne pouvait pas résoudre l'alias `@/...`. Sans
 * incidence pratique ici (bootstrap qui ne se rejoue qu'une fois, une
 * précision à la journée près suffisait déjà), gardé pour cohérence avec
 * le reste du code.
 *
 * Idempotent PAR EXISTENCE : ne crée Saison 1 que si aucune ligne
 * `Season` n'existe encore.
 *
 * Note (transparence, pas un bug) : `ensureActiveSeasonExists`
 * (`@/lib/seasons.ts`) fait déjà ce même travail de façon dynamique
 * (numéro = MAX existant + 1) à chaque chargement de Home et à chaque
 * passage du cron `close-sessions` — bien plus fréquent que le passage
 * quotidien de cette réconciliation. En pratique, une saison existe donc
 * quasiment toujours déjà avant que cette fonction ne s'exécute ; elle
 * reste incluse pour ne perdre aucune logique du script d'origine, et
 * reste un filet de sécurité sans risque (idempotente, no-op si une
 * saison existe déjà).
 */
export async function seedInitialSeason(): Promise<void> {
  const existing = await prisma.season.findFirst();
  if (existing) return;

  const now = wallClockNow();
  await prisma.season.create({
    data: {
      number: 1,
      name: "Saison 1",
      startDate: now,
      endDate: endOfMonthUTC(now),
      isActive: true,
    },
  });
}
