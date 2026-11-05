# Développement cloud — pilote GameNight

Le plan de travail reste l’[issue #400](https://github.com/ZeyFro/gamenight/issues/400). Relire aussi AGENTS.md, docs/ETAT.md et docs/REPRISE_AUTONOME.md. Les routines ChatGPT de 22 h et 08 h restent inchangées. L’environnement Codex Cloud publié peut servir aux tâches lancées à la demande ; le pilote utilise un déclencheur GitHub hébergé indépendant du PC.

## Ce que fait le pilote

- Prend au plus une tâche indépendante déjà approuvée dans `.github/cloud-dev-queue.json`. L’ordre de la file est choisi par le propriétaire. On n’importe ni les commentaires publics ni les décisions à prendre. Avant et après l’API, vérifie les branches, les PR ouvertes, les fichiers réservés, le plafond de dix PR et l’absence d’une PR déjà créée pour la tâche. Une PR de l’agent déjà ouverte bloque la suivante.
- Un seul agent, limité à un fichier versionné autorisé : document ou petit module TypeScript de `src/lib` sans accès externe. Le pilote est documentaire : corriger l’index pour pointer vers le suivi vivant. Rien ne touche #396 ni les lots Tower réservés. Nouvelle tâche = nouvel identifiant et revue de la file.
- Valide le changement sans exécuter le contenu proposé. Git vérifie le diff, Node la syntaxe des éventuels modules TypeScript. Au plus deux corrections après la première proposition ; pas de relance automatique du modèle après une erreur HTTP. Un push puis une PR Draft, jamais de fusion ni passage Ready. Si le push réussit mais que la PR est refusée, la branche bloque un second appel payant : ouvrir le Draft depuis cette branche après diagnostic.
- Aucun secret de l’application, migration, appel à Neon/Discord, activation ou opération Production. La CI générale applique des migrations à son PostgreSQL jetable : le commit du pilote porte `[skip ci]`. Pour un changement applicatif futur, obtenir des tests fonctionnels isolés avant intégration ; le contrôle syntaxique ne les remplace pas.

## Activation après accord

1. Relire puis fusionner manuellement cette PR. Le déclencheur planifié s’exécute seulement depuis `main`, à 02 h 17 Europe/Paris. Le job qui appelle l’API reste arrêté tant que la variable d’activation n’est pas configurée.
2. Créer une clé OpenAI dédiée au projet, restreinte aux opérations Responses utilisées. La mettre dans GitHub → Settings → Secrets and variables → Actions, sous `GAMENIGHT_CLOUD_DEV_OPENAI_KEY`. Aucun secret dans un chat, un fichier ou un log.
3. Le réglage GitHub « Allow GitHub Actions to create and approve pull requests » est désactivé au relevé du 5 novembre. Après accord, l’activer pour la création des Drafts. Le script ne fait aucune approbation. Aucun jeton GitHub personnel supplémentaire.
4. Passer la variable Actions `GAMENIGHT_CLOUD_DEV_ENABLED` à `true`, puis lancer **Développement cloud → Run workflow** sur `main`. Vérifier le runner GitHub hébergé, les jetons consommés, la branche `codex/cloud-dev/index-reprise`, le diff et le statut Draft. Le premier run planifié doit ensuite apparaître avec l’événement `schedule`. Pour arrêter, retirer la variable ou la passer à `false` ; désactiver le workflow pour supprimer aussi les essais sans API.

Avec GPT-6.1 Sol en tarif standard au 5 novembre 2026, les trois générations maximum (10 000 jetons d’entrée et 4 000 de sortie chacune) représentent au plus 0,18 USD de génération par exécution au tarif publié, hors taxes, supplément contractuel et changement de tarif. Le comptage d’entrée précède chaque génération ; aucun outil facturable n’est activé. [Tarifs API](https://developers.openai.com/api/docs/pricing?upgrade-intent=undefined). La facture API est distincte du quota ChatGPT : aucun chiffre ne permet ici de garantir une réserve ChatGPT de 10 %.

Le test de la branche de préparation utilise une réponse simulée : il vérifie les rejets, le nombre maximal de corrections et l’absence de modification conservée. Il ne valide ni une clé API, ni la création du Draft par le bot, ni le premier lancement planifié.
