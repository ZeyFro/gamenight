-- Retour arrière de *_shop_balance_purchase_reason : retire la valeur SHOP_BALANCE_PURCHASE de l'enum "XpReason".
-- Refuse si un XpEvent l'utilise. Reconstruit le type avec les libellés existants dans leur ordre.
BEGIN;
DO $$
DECLARE
  labels text;
BEGIN
  IF EXISTS (SELECT 1 FROM "XpEvent" WHERE "reason"::text = 'SHOP_BALANCE_PURCHASE') THEN
    RAISE EXCEPTION 'Rollback interdit : XpEvent contient SHOP_BALANCE_PURCHASE (achats au solde).';
  END IF;
  IF (SELECT count(*) FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid JOIN pg_class c ON c.oid = a.attrelid
      WHERE t.typname = 'XpReason' AND a.attnum > 0 AND NOT a.attisdropped AND c.relkind IN ('r', 'p', 'm')) <> 1 THEN
    RAISE EXCEPTION 'Rollback interdit : une autre colonne utilise le type XpReason (attendu : XpEvent.reason seul).';
  END IF;
  SELECT string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) INTO labels
    FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'XpReason' AND e.enumlabel <> 'SHOP_BALANCE_PURCHASE';
  EXECUTE 'CREATE TYPE "XpReason__rollback" AS ENUM (' || labels || ')';
END $$;
ALTER TABLE "XpEvent" ALTER COLUMN "reason" TYPE "XpReason__rollback" USING ("reason"::text::"XpReason__rollback");
DROP TYPE "XpReason";
ALTER TYPE "XpReason__rollback" RENAME TO "XpReason";
DELETE FROM "_prisma_migrations" WHERE "migration_name" LIKE '%\_shop_balance_purchase_reason';
COMMIT;
