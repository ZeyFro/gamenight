# Plan de réconciliation de docs/REPRISE_AUTONOME.md (04/11/2026)

**Ne pas éditer `docs/REPRISE_AUTONOME.md` dans ce lot** : la reprise de référence reste inchangée. #325 est gelée jusqu'en janvier ; elle ne réserve pas les fichiers selon la décision de Maxime. Ce plan documentaire n'intervient pas dans cette PR et décrit uniquement les écarts à réconcilier ultérieurement.

## Corrections prioritaires après résolution du conflit
- Remplacer l'ancien `main=8a1cdf3` par une référence Git vérifiée au jour du merge ; le relevé du 4 novembre est `7cd6015` (#374). Ne pas figer cette référence pour décembre.
- Marquer comme historiques les anciennes listes de PR ouvertes. #360, #362, #367, #369, #371, #372, #373 et #374 sont fusionnées ; #325 reste gelée et #370 reste ouverte au relevé. Les PR #384, #385, #387, #388, #392, #394, #395, #396, #397 et #399 restent ouvertes. Réconcilier ces états au moment de l'édition plutôt que reprendre cette liste comme actuelle.
- Séparer les trois états : **code fusionné**, **configuré en production**, **testé avec de vrais membres**. Une Preview READY ne prouve pas un OAuth fonctionnel.
- Signaler que le snapshot du 02/11 existe mais n'a pas été restauré en isolation ; #325 reste interdit sans répétition de restauration et fenêtre de maintenance.
- Préciser les décisions §26 : 2–8 membres par équipe, une équipe par joueur et par communauté, 7 jours après départ volontaire ; en cas de dissolution, seul le capitaine déclencheur subit le délai. Ranker 30, High Ranker 100 + saison terminée, intersaisons 1–3 janvier et 29–31 mars, lancement 04/01/2027 (repli 01/02/2027).
- Conserver les règles quorum (preuve SUBMITTED), contestation encadrée 7B, arbitre indépendant si Maxime est concerné.
- Vérifier les commandes Discord réellement installées par lecture de l'API ; script d'enregistrement #363 fusionné ≠ commandes installées.
- Préparer la procédure YAGPDB/Atlas et les 134 rôles étage sans suppression avant inventaire des dépendances.
- Interdire les tests Preview avec écriture tant que l'hôte Neon et le blocage des messages/crons ne sont pas attestés.

## Contrôle
Une fois #325 résolue, relire la version actuelle de REPRISE_AUTONOME et n'appliquer que les paragraphes toujours exacts ; ne jamais copier aveuglément ce rapport daté.

**PR documentaire uniquement ; aucun changement sur REPRISE_AUTONOME dans cette branche.**
