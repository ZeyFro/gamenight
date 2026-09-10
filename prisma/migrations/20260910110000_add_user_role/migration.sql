-- PR "Accès & secrets" — rôle admin. Additive : tous les users existants
-- basculent automatiquement en 'USER' (valeur par défaut), personne ne
-- devient admin implicitement à cette migration. Voir ADMIN_DISCORD_IDS
-- (env, src/lib/admin.ts) pour le filet anti-verrouillage indépendant de
-- ce champ.

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'USER';
