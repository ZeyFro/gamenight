# Suggestions de créneaux pour une soirée

Base = main, à vérifier avant de merger.

## Comportement

Dans `/sessions`, le formulaire conserve la saisie manuelle de date et d'heure.
Le bloc « Trouver le bon créneau » propose une durée (1 h, 1 h 30, 2 h ou 3 h)
et une recherche explicite pour l'organisateur et les personnes cochées dans
« Qui prévenir ? ». Aucune recherche n'est déclenchée à l'ouverture de la page.

La recherche couvre les sept prochains jours, avec des départs toutes les
30 minutes entre 18 h et 23 h 30 et au moins 30 minutes de préavis. Elle propose
jusqu'à trois jours distincts, classés par nombre de personnes disponibles,
puis par date et heure. Les horaires suivent l'horloge murale déjà utilisée
par GameNight ; aucune nouvelle conversion de fuseau n'est introduite.

Le calcul vérifie toute la durée, les plages contiguës, les trous, les exceptions
et chaque jour si la fin passe minuit. Les conventions des disponibilités
hebdomadaires restent celles du calendrier existant. Une absence de saisie est
signalée comme inconnue, jamais comptée comme disponible. Un organisateur
explicitement indisponible exclut le créneau ; un organisateur sans saisie est
signalé « à confirmer ». Avec des invités, au moins un invité doit être disponible.

Choisir une suggestion remplit seulement les champs `date` et `time`.
La durée choisie sert au calcul, elle ne devient pas une durée enregistrée de
la soirée. La création, ses contrôles et son mécanisme d'idempotence restent
ceux du formulaire existant. Aucune présence n'est confirmée automatiquement.

Les changements de destinataires ou de durée invalident les résultats et les
réponses déjà en vol. Une erreur ou l'absence de résultat laisse la saisie
manuelle utilisable. Le lien vers `/disponibilites` permet de compléter sa saisie.

## Accès et coût

- Authentification via `getCurrentUser({ recordActivity: false })`, avec la porte
  de reconnexion forcée existante ; l'identité du créateur vient de la session.
- Validation des entrées, limite de 1 000 identifiants et six recherches par
  minute via le limiteur existant (en mémoire, par instance serveur).
- Avec isolation active, revalidation de l'organisateur et des invités contre
  le serveur actif et ses appartenances ACTIVE. Un identifiant étranger, supprimé
  ou devenu inaccessible fait refuser toute la recherche, sans réduire les
  participants silencieusement. Flags OFF conserve le roster historique.
- Une lecture groupée des utilisateurs autorisés puis deux lectures groupées
  des disponibilités, en plus des lectures d'authentification et de résolution
  de communauté. Aucun accès par personne ou par créneau ; exceptions limitées
  aux huit jours nécessaires pour couvrir une fin après minuit.
- La réponse ne contient que des dates, heures et compteurs agrégés ; aucun
  horaire personnel brut ni identifiant d'invité.
- Aucun appel Discord, aucune écriture de soirée, aucun nouveau flag, aucune
  migration ni dépendance.

## Validation et limites

- Tests de calcul : durée complète, bornes exactes, exceptions, minuit, inconnus,
  classement, déduplication et anciennes valeurs malformées.
- Tests d'action : authentification, reconnexion forcée, entrées invalides,
  limitation et erreur de lecture.
- Tests DOM : champs réellement soumis, groupes/individus, double clic,
  changement de sélection/durée en vol, échec et nouvelle recherche ; aucune
  création au clic sur un créneau.
- Tests Postgres : isolation A/B, changement de serveur, retrait, suspension,
  exceptions et compatibilité flags OFF. La base locale n'est pas disponible
  dans cette session : ces cinq scénarios doivent être exécutés dans le service
  Postgres 16 de CI, en série avec les autres intégrations.
- TypeScript et ESLint locaux. Le build local utilise Webpack et des réponses
  de fontes locales temporaires, car Google Fonts est inaccessible depuis ce
  terminal. Le build normal de CI/Vercel doit confirmer la compilation finale.
- Rendu visuel PC/mobile et connexion réelle non vérifiés dans cette session.
  Vérifier sur la Preview : choisir des invités, demander deux heures, choisir
  un créneau, contrôler date/heure et invités, puis essayer la saisie manuelle.

Cette PR traite la suggestion à partir des disponibilités existantes. Le vote
sur des créneaux propres à une soirée, la liste d'attente et les réponses depuis
Discord restent des travaux séparés. Elle ne constitue pas une garantie de
latence ou de réduction de facturation Neon en production.
