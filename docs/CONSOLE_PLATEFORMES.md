# Console : connexions Discord, plateformes et crossplay (sujet J)

Flags (OFF par défaut, exactement `true`) : `DISCORD_CONNECTIONS_SCOPE_ENABLED`, `GAME_PLATFORMS_ENABLED`. Migration `20261118130900_platform_identities_crossplay` (additive, APRÈS #416).

## Scope OAuth `connections`
- Jamais demandé à la connexion ordinaire (`identify email guilds`). Seule la case de consentement de `/profil/parametres` déclenche une reconnexion avec `connections`.
- La reconnexion repasse par toutes les gardes de `signIn` : Membership ACTIVE requise (S0), exception `ADMIN_DISCORD_IDS`, scope `guilds` obligatoire. Les connexions ne sont lues qu'APRÈS admission ; un échec de lecture ne bloque pas la connexion.
- Mapping : xbox, playstation, epicgames, battlenet, riotgames vers les identifiants L3-01 (+ `riotId`), steam proposé comme suggestion seulement (la liaison Steam garde son OpenID).
- Les valeurs sont des SUGGESTIONS (`PlatformConnectionSuggestion`) : préremplissage des champs vides, modifiables, jamais écrasées sans validation du formulaire. Bouton « Effacer ces suggestions ».
- Un jeton portant `connections` n'est pas persisté (callback `jwt`), jamais journalisé.

## Plateformes et crossplay
- Fiche jeu : plateformes et crossplay déclarés par un membre qui possède le jeu. Backfill : jeux Steam = Windows.
- `/bibliotheque/plateformes` : onglets PC / PlayStation / Xbox / Switch, « populaires sur ta plateforme » (nombre de membres actifs possédant le jeu), ajout rapide à sa bibliothèque.
- Défis : aucun défi solo ou d'équipe dont le jeu est impossible sur les plateformes déclarées du joueur (équipe : au moins deux membres capables). Plateforme inconnue = jamais exclu. Le crossplay n'ouvre pas un jeu à une plateforme que le joueur n'a pas.

## Preuve : photo d'écran TV
Variante acceptée (indépendante des flags) : mention « photo TV » ou « [TV] » dans la description, code visible sur la photo. Les votants reçoivent la consigne de vérifier le code ; aucune validation par IA.

## Limites
- Le tag de plateforme des jeux non Steam dépend des déclarations des membres.
- Le jeton OAuth précédemment stocké reste utilisé par le cron d'avatars ; la reconnexion avec `connections` ne le remplace pas.
