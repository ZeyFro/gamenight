-- Relais forum des annonces joueurs (D3), corrections de revue du 27/11/2026 : uniquement des ajouts (trois colonnes nullables).
--  - forumPostingAt : marque posée AVANT la création du post forum (au plus un post par annonce, même après un plantage) ;
--  - forumRemovedAt : fil SUPPRIMÉ (profil masqué, annonce ou compte retiré) ; distinct de forumClosedAt (fil archivé à l expiration) ;
--  - forumSweptAt   : curseur du balayage du cron (une ligne bloquée en permanence ne monopolise plus les 25 lignes traitées par passage).
ALTER TABLE "PlayerClassified"
  ADD COLUMN "forumPostingAt" TIMESTAMP(3),
  ADD COLUMN "forumRemovedAt" TIMESTAMP(3),
  ADD COLUMN "forumSweptAt" TIMESTAMP(3);
