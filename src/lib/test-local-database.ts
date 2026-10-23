/** Garde des suites d'intégration : TEST_DATABASE_URL doit viser un PostgreSQL LOCAL, vérifié AVANT toute requête (DROP/CREATE/TRUNCATE). */
export function assertLocalTestDatabase(url: string | undefined): void {
  let parsed: URL;
  try { parsed = new URL(String(url)); } catch { throw new Error("TEST_DATABASE_URL illisible : refus (aucune requête envoyée)"); }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new Error("TEST_DATABASE_URL doit être postgresql:// : refus (aucune requête envoyée)");
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) throw new Error(`TEST_DATABASE_URL vise l'hôte ${parsed.hostname} : PostgreSQL local (127.0.0.1) uniquement, refus (aucune requête envoyée)`);
}
