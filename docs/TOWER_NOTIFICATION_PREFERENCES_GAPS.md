# Notifications configurables (§24) — audit avant lancement

**VÉRIFIÉ dans le code** `src/lib/notification-preferences.ts` :
- Catégories : `SESSION`, `ROULETTE`, `TOURNAMENT`, `INSTANT_SESSION` (ligne 5).
- `getUserNotificationPreferences` et `setOwnNotificationPreference` permettent de lire et modifier les choix individuels.
- Repli historique `silenceReminders` si aucune préférence explicite ; synchronisation de ce repli lors du changement de SESSION.

## Non couverts / à démontrer
- Préférences distinctes pour défi Tower, contestation, résultats de votes, rappel saisonnier et récompense.
- Distinction souhaitée : notification dans GameNight / MP Discord / mention dans salon, par événement, avec refus des MP non disponibles.
- Gestion des horaires de silence, fréquence maximum, regroupement et opt-out sans perdre les événements importants.
- Parcours réel : bouton dans `/profil/parametres` doit conserver les préférences avec un second appareil.

## Recette sandbox
Deux comptes avec préférences opposées ; générer des événements fictifs et contrôler que la file n'envoie pas de MP au compte désactivé, et ne divulgue rien aux autres communautés. Ne pas tester en Preview tant que la sortie Discord n'est pas matériellement interdite.

**Aucun changement de paramétrage n'est effectué.**