# Plan de réconciliation de docs/REPRISE_AUTONOME.md (04/11/2026)

**Ne pas éditer ce fichier actuellement** : il est déjà modifié par la PR ouverte #325. Conserver son contenu historique jusqu'à résolution/merge de cette PR. Le document suivant décrit uniquement les écarts à intégrer ensuite.

## Corrections prioritaires après résolution du conflit
- Remplacer l'ancien `main=8a1cdf3` par une référence Git vérifiée au jour du merge ; le dernier commit vérifié dans cet audit est `510f3a0` (PR #366). Ne pas figer cette référence pour décembre.
- Marquer comme historique la liste « seulement #325 ouverte ». Les PR en attente couvrent l'accès, le matchmaking, les équipes, le calendrier, les rôles et la sécurité Preview.
- Séparer les trois états : **code fusionné**, **configuré en production**, **testé avec de vrais membres**. Une Preview READY ne prouve pas un OAuth fonctionnel.
- Signaler que le snapshot du 02/11 existe mais n'a pas été restauré en isolation ; #325 reste interdit sans répétition de restauration et fenêtre de maintenance.
- Préciser les décisions §26 : 2–8 membres par équipe, 7 jours de délai, Ranker 30, High Ranker 100 + saison terminée, intersaisons 1–3 janvier et 29–31 mars, lancement 04/01/2027.
- Conserver les règles quorum (preuve SUBMITTED), contestation encadrée 7B, arbitre indépendant si Maxime est concerné.
- Vérifier les commandes Discord réellement installées par lecture de l'API ; script d'enregistrement #363 fusionné ≠ commandes installées.
- Préparer la procédure YAGPDB/Atlas et les 134 rôles étage sans suppression avant inventaire des dépendances.
- Interdire les tests Preview avec écriture tant que l'hôte Neon et le blocage des messages/crons ne sont pas attestés.

## Contrôle
Une fois #325 résolue, relire la version actuelle de REPRISE_AUTONOME et n'appliquer que les paragraphes toujours exacts ; ne jamais copier aveuglément ce rapport daté.

**PR documentaire uniquement ; aucun changement sur REPRISE_AUTONOME dans cette branche.**
