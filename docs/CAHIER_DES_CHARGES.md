# CAHIER DES CHARGES GLOBAL
# THE TOWER 2.0 × GAMENIGHT

**Version de référence : octobre 2026 — Exigences fonctionnelles initiales et consolidées**

**Projet :** The Tower 2.0  
**Serveur Discord :** The Tower  
**Guild ID :** `553922938101825536`  
**Application centrale :** GameNight  
**URL :** https://gamenight-zeyfro.vercel.app  
**Dépôt :** `ZeyFro/gamenight`  
**Technologies existantes :** Discord, Next.js, TypeScript, Prisma, PostgreSQL/Neon, Vercel.

---

## 1. Vision générale du projet

### 1.1. Ambition

Transformer The Tower en une communauté gaming francophone moderne, immersive, attractive et durable, inspirée de l'univers de **Tower of God**.

L'objectif ne consiste pas simplement à réorganiser un serveur Discord.

Il s'agit de créer une véritable expérience communautaire dans laquelle chaque joueur peut :

- Découvrir facilement d'autres joueurs.
- Trouver des partenaires correspondant à ses jeux et préférences.
- Participer à des soirées et des événements.
- Créer ou rejoindre une équipe.
- Gravir une Tour virtuelle.
- Accomplir des défis originaux.
- Débloquer des grades et des récompenses.
- Participer à des compétitions individuelles et collectives.
- Développer sa réputation.
- Faire partie d'une communauté dans laquelle il souhaite revenir régulièrement.

L'ambition visuelle et fonctionnelle est de provoquer une réaction immédiate chez les nouveaux membres :

**« Wow, ce serveur est incroyable ! »**

Le projet doit associer convivialité, compétition, humour, progression et interactions sociales.

### 1.2. Positionnement

The Tower accueillera :

- Les joueurs occasionnels.
- Les joueurs réguliers.
- Les joueurs compétitifs.
- Les créateurs d'équipes.
- Les organisateurs de soirées.
- Les personnes souhaitant simplement discuter ou découvrir de nouveaux jeux.

Aucun jeu ne doit être imposé.

Le serveur doit rester multigaming et ne pas dépendre d'une licence particulière.

### 1.3. Public et croissance

Le lancement sera prioritairement francophone.

Une internationalisation pourra être envisagée lors de la croissance de la communauté, avec des étapes de réflexion autour de 10 000 puis 50 000 membres actifs.

La croissance devra s'appuyer sur la qualité de l'expérience, la fidélisation, les événements, les partenariats gaming et éventuellement les créateurs de contenu.

Le lancement public ne devra pas être annoncé comme terminé avant validation des fonctionnalités essentielles.

### 1.4. Budget

Le lancement doit fonctionner avec un budget gratuit.

Les fonctionnalités essentielles ne doivent pas dépendre de Discord Nitro, de boosts payants ou de services externes payants.

Les limites des services gratuits doivent être étudiées avant de promettre une capacité illimitée.

---

## 2. Architecture générale : Discord et GameNight

### 2.1. Rôle de Discord

Discord est le lieu de vie de la communauté.

Il sert à :

- Discuter.
- Accueillir les nouveaux membres.
- Présenter les joueurs.
- Rechercher des partenaires.
- Recruter.
- Participer aux défis.
- Déposer des preuves.
- Voter.
- Consulter les annonces.
- Utiliser les salons vocaux.
- Faire fonctionner les interactions communautaires.

L'essentiel de l'expérience quotidienne doit rester accessible depuis Discord.

### 2.2. Rôle de GameNight

GameNight est le moteur applicatif central.

Il assure les fonctionnalités pertinentes liées aux profils, jeux, équipes, soirées, événements, classements et progression.

L'intégration avec Discord doit être cohérente et bidirectionnelle lorsque cela est techniquement nécessaire.

Une action effectuée dans GameNight doit pouvoir produire le bon résultat dans Discord, sans doublons.

Inversement, une interaction Discord doit pouvoir être enregistrée dans GameNight lorsque son fonctionnement l'exige.

### 2.3. Accès libre et accès avancé

La connexion à GameNight ne doit pas être obligatoire pour :

- Rejoindre le Discord.
- Lire les espaces publics autorisés.
- Discuter.
- Rencontrer des joueurs.
- Consulter les événements.
- Rechercher des joueurs dans les forums publics.

La connexion devient obligatoire pour les fonctionnalités avancées nécessitant un suivi :

- Créer et administrer une équipe persistante.
- S'inscrire aux événements nécessitant une identification.
- Participer aux épreuves avec progression enregistrée.
- Obtenir des grades liés à l'Ascension.
- Recevoir des récompenses personnelles.
- Gérer les fonctionnalités avancées du profil.

L'objectif est d'éviter qu'un nouveau membre soit immédiatement confronté à une inscription obligatoire.

---

## 3. Organisation et architecture du serveur

### 3.1. Catégories principales

Le serveur repose sur sept espaces principaux :

**🏰 LE PORTAIL**

Espace d'accueil, règlement, rôles et orientation.

**🎲 LES ÉPREUVES GAMENIGHT**

Soirées, tournois, événements, calendrier, annonces et activités organisées.

**💬 LE HALL DES RÉGULIERS**

Espace social : discussions, présentations, jeux, actualités, sondages et rencontres.

**⚔️ LE HALL DES ÉQUIPES**

Recherche de joueurs, recrutement, guildes, équipes et projets collectifs.

**🗼 L'ASCENSION**

Défis, étages, progression, preuves, épreuves et récompenses.

**🔊 LES SALLES DE LA TOUR**

Salons vocaux, regroupements et activités vocales.

**👑 LE SOMMET**

Rankers, classements, records, distinctions et compétitions prestigieuses.

L'ordre définitif et la disposition devront privilégier l'accessibilité des activités GameNight et la facilité de navigation.

### 3.2. Principes d'organisation

- Noms homogènes et lisibles.
- Emojis cohérents.
- Descriptions utiles.
- Navigation adaptée aux appareils mobiles.
- Nombre de salons limité au nécessaire.
- Pas de salons vides créés sans utilité.
- Pas de duplication de fonctions existantes.
- Réutilisation prioritaire de la structure existante.
- Préservation des salons privés et des contenus importants.
- Usage des fils et panneaux interactifs lorsque cela réduit l'encombrement.

Le serveur ne doit pas afficher une multitude de catégories « Etage 1 », « Etage 2 », etc.

---

## 4. Accueil et onboarding

### 4.1. Objectif

Un nouveau joueur doit comprendre rapidement :

1. Où il vient d'arriver.
2. Comment accéder à la communauté.
3. Quelles règles respecter.
4. Comment choisir ses centres d'intérêt.
5. Comment rencontrer des joueurs.
6. Comment rejoindre une soirée.
7. Comment gravir la Tour.

L'accueil doit être immersif, mais simple.

### 4.2. Parcours attendu

Le parcours doit pouvoir commencer dans Discord sans imposer GameNight.

Un système d'orientation pourrait proposer :

- Trouver des joueurs.
- Rejoindre une soirée.
- Découvrir les équipes.
- Commencer l'Ascension.
- Découvrir GameNight.

L'interface doit présenter rapidement une première action concrète.

### 4.3. Règlement et validation d'accès

Le fonctionnement existant des rôles d'accès, notamment Régulars, doit être vérifié.

Il ne faut pas supprimer un ancien mécanisme de validation sans avoir vérifié quel rôle il attribue.

Tout nouveau parcours doit être testé comme un véritable nouveau membre et pas uniquement avec un aperçu administrateur.

### 4.4. Rôles et intérêts

Les systèmes de sélection de jeux et d'intérêts déjà existants doivent être modernisés plutôt que dupliqués.

L'onboarding natif Discord peut être envisagé si son fonctionnement est compatible avec les permissions du serveur.

Son activation n'est pas une obligation si elle impose une réorganisation contraire à l'expérience souhaitée.

---

## 5. Identité visuelle et expérience utilisateur

### 5.1. Direction artistique

L'identité doit mélanger :

- Univers Tower of God.
- Science-fiction et gaming futuriste.
- Ambiance holographique.
- Dégradés et effets lumineux.
- Hiérarchie de grades.
- Humour communautaire.
- Sensation de progression et d'aventure.

### 5.2. Éléments visuels

À harmoniser :

- Icône du serveur.
- Bannière, si les capacités disponibles le permettent.
- Descriptions.
- Messages d'accueil.
- Panneaux.
- Cartes de défis.
- Visuels de récompenses.
- Présentation des équipes.
- Classements.
- Annonces saisonnières.

Les illustrations doivent être originales ou utilisées avec les droits appropriés.

### 5.3. Ton communautaire

Ton convivial, drôle, parfois taquin ou légèrement moqueur, mais toujours bienveillant.

Le concept encourage les exploits insolites et les défis amusants.

Aucune humiliation publique, discrimination ou harcèlement ne doit être encouragé.

---

## 6. Rôles, grades et hiérarchie

### 6.1. Grades emblématiques

Conserver et clarifier les principaux grades inspirés de la Tour :

- Régulars.
- Irregular.
- Ranker.
- High Ranker.

Les conditions d'obtention et le prestige associé doivent être cohérents.

### 6.2. Séparation des pouvoirs

La progression d'un joueur ne doit pas lui accorder automatiquement des pouvoirs administrateur.

Un High Ranker peut constituer un grade prestigieux, mais les permissions de modération doivent relever de rôles techniques distincts.

Les responsabilités du staff doivent être séparées des récompenses communautaires.

### 6.3. Anciens rôles Etage

Le serveur possède historiquement 134 rôles d'étages.

La nouvelle architecture doit progressivement les remplacer par une progression numérique enregistrée dans le système.

**Décision consolidée : supprimer les 134 anciens rôles Etage après préparation et vérification de leur remplacement.**

Aucun nouveau rôle Discord permanent ne doit être créé pour chaque étage.

Les suppressions doivent être précédées d'une analyse des dépendances et des permissions.

### 6.4. Rôles techniques et historiques

Examiner distinctement :

- Rôles administrateurs.
- Rôles de modération.
- Rôles de jeux.
- Rôles de bot.
- Rôles d'équipes.
- Rôles de sanctions.
- Rôles de notifications.
- Rôles obsolètes.

Les rôles inutiles doivent être retirés seulement après vérification.

---

## 7. Nouvelle Ascension : progression infinie

### 7.1. Concept

Chaque membre commence sa nouvelle progression dans la Tour.

La progression repose sur des étages virtuels :

Etage 1, Etage 2, Etage 3, etc.

**Aucun plafond d'étage.**

La progression doit être stockée dans GameNight ou le système associé et affichée par le bot Discord.

### 7.2. Remplacement de l'ancien système

La nouvelle Ascension remplace l'ancienne progression d'étages assurée par Atlas.

Il ne doit pas exister deux sources concurrentes d'attribution.

Le remplacement ne doit pas supprimer les autres fonctionnalités utiles d'Atlas.

Le nouveau compteur démarre de zéro sans effacer les profils GameNight, les soirées ou les autres historiques existants.

### 7.3. Obtention des étages

La progression est principalement obtenue en réussissant des défis.

Les défis plus difficiles doivent pouvoir rapporter davantage.

**Barème initial proposé, non définitivement validé :**

- Défi facile : +1 étage.
- Défi moyen : +2 étages.
- Défi difficile : +3 étages.

Le système doit empêcher la double attribution et les manipulations abusives.

### 7.4. Progression permanente

L'étage acquis reste conservé entre les saisons.

Les classements saisonniers peuvent être réinitialisés, mais pas la progression permanente.

Un nouveau membre doit disposer de mécanismes lui permettant de participer aux compétitions saisonnières sans devoir rattraper artificiellement des années de progression.

---

## 8. Défis solo et collectifs

### 8.1. Principe général

Les défis sont le cœur de l'Ascension.

Ils doivent encourager :

- La découverte de jeux.
- La coopération.
- L'activité communautaire.
- La créativité.
- L'humour.
- Les défis insolites.
- Les performances individuelles.
- Les accomplissements en équipe.

### 8.2. Défis solo

Un bouton interactif **« Mon défi »** permet de recevoir un défi aléatoire.

Règle retenue :

**Une attribution toutes les 12 heures au maximum.**

Le joueur dispose ensuite de 48 heures pour accomplir son défi.

### 8.3. Défis d'équipe

Chaque équipe reçoit automatiquement un défi quotidien.

Les défis collectifs peuvent nécessiter une coopération réelle.

Les règles doivent définir les participants éligibles et éviter qu'un même accomplissement donne des récompenses abusives à plusieurs comptes.

### 8.4. Quotas

Un joueur peut obtenir au maximum :

**Deux réussites validées par jour**, défis solo et collectifs confondus.

Le quota doit être respecté même lorsque plusieurs validations arrivent simultanément.

### 8.5. Variété des défis

Les défis peuvent être :

- Gaming.
- Créatifs.
- Artistiques.
- Absurdes.
- Humoristiques.
- De coopération.
- De découverte.
- De longue durée.
- Hors jeu, lorsque les règles sont adaptées.

Exemples :

- Jouer trois heures à Minecraft.
- Construire une maison et présenter le résultat.
- Réussir un objectif collectif.
- Faire découvrir un jeu à un membre.
- Réaliser une création originale.

Les défis doivent rester légaux, sûrs et compatibles avec les règles Discord.

### 8.6. Accessibilité

Un défi doit pouvoir être remplacé lorsque le membre ne possède pas le jeu nécessaire.

Aucun achat de jeu ne doit être obligatoire pour participer à la saison de lancement.

### 8.7. Proposition de défis

Les membres de grades élevés pourront proposer de nouveaux défis.

L'accès à cette fonction à partir du grade Ranker a été proposé, sans seuil définitivement validé.

La génération de défis par intelligence artificielle n'est pas nécessaire pour la première version.

---

## 9. Preuves, validation et votes

### 9.1. Dépôt d'une preuve

Lorsqu'un défi est terminé, le joueur dépose une preuve adaptée à celui-ci.

Exemples :

- Capture d'écran.
- Photo.
- Vidéo.
- Témoignage.
- Déclaration, lorsque la règle l'autorise.
- Autre élément pertinent.

La preuve doit normalement correspondre à une réalisation postérieure à l'attribution du défi.

Les défis autorisant des preuves anciennes doivent l'indiquer explicitement.

### 9.2. Validation communautaire

La validation est assurée par un système de vote communautaire piloté par le bot.

Règles initiales :

- Durée du vote : 24 heures.
- Minimum de trois votants distincts.
- Majorité favorable obligatoire.
- Interdiction de voter pour sa propre preuve.

Une égalité ne vaut pas validation.

Sans quorum, la preuve reste en attente ; le mécanisme de relance ou de clôture doit être précisé.

### 9.3. Contestations

Un membre doit pouvoir contester un résultat selon des règles publiques.

Le système doit empêcher :

- Les votes multiples.
- Les interactions rejouées.
- Les votes non autorisés.
- Les récompenses attribuées deux fois.
- Les abus d'équipes.
- Les manipulations de résultats.

### 9.4. Intelligence artificielle

**Aucune IA ne doit valider automatiquement les preuves dans la version initiale.**

L'IA peut éventuellement aider à rédiger ou organiser les défis, mais pas décider arbitrairement de leur réussite.

---

## 10. Annonces automatiques et animation

### 10.1. Partage des réussites

Une réussite validée peut être annoncée automatiquement dans le salon général.

L'objectif est de montrer les exploits des membres et de faire vivre le Discord.

Une annonce peut présenter :

- Le joueur ou l'équipe.
- Le défi réalisé.
- La preuve autorisée à être publiée.
- La difficulté.
- Le résultat.
- La récompense.
- L'étage atteint.

### 10.2. Confidentialité

Le joueur doit être informé des conditions de publication lors du dépôt de sa preuve.

Les informations personnelles ne doivent pas être exposées inutilement.

### 10.3. Animation

Prévoir :

- Réussites marquantes.
- Exploits insolites.
- Défis amusants.
- Distinctions humoristiques.
- Récapitulatifs hebdomadaires.
- Résultats de compétitions.
- Mise en avant des joueurs actifs.

Les annonces ne doivent pas saturer le général.

Pas de fausses réussites ou de faux événements destinés à simuler artificiellement une communauté active.

---

## 11. Équipes, guildes et recrutement

### 11.1. Fonctionnement

Les joueurs doivent pouvoir :

- Découvrir des équipes existantes.
- Créer une équipe persistante.
- Rejoindre une équipe.
- Présenter leur candidature.
- Recruter.
- Participer à des soirées.
- Relever des défis collectifs.
- Participer à des classements.

### 11.2. Informations des équipes

Une équipe pourra disposer :

- D'un nom.
- D'une identité visuelle.
- D'une présentation.
- D'un capitaine ou responsable.
- D'une liste de membres.
- De jeux favoris.
- D'objectifs.
- De critères de recrutement.
- D'événements et rendez-vous.

### 11.3. Forums

Réutiliser les forums existants :

- Recherche de joueurs.
- Recrutement d'équipes.
- Projets et aventures.

Les tags doivent aider les joueurs à trouver les publications pertinentes.

### 11.4. Intégration GameNight

GameNight doit conserver les équipes et leurs informations.

La fonctionnalité ne doit pas être reconstruite indépendamment de l'implémentation déjà préparée dans la PR #329.

Les règles exactes relatives aux tailles des équipes, à l'appartenance multiple et aux changements d'équipe restent à définir.

---

## 12. Recherche de joueurs et matchmaking

### 12.1. Objectif

Permettre à un membre de trouver facilement des partenaires compatibles.

### 12.2. Critères

Selon les informations facultatives disponibles :

- Jeux.
- Plateformes.
- Disponibilités.
- Mode compétitif ou détente.
- Niveau de jeu.
- Langue.
- Préférences communautaires.
- Habitudes de jeu.
- Centres d'intérêt.

### 12.3. Fonctionnement social

Prévoir des parcours comme :

- « Qui joue ce soir ? »
- « Je cherche une partie ».
- Recherche par jeu.
- Découverte de profils publics.
- Proposition de partenaires compatibles.
- Recrutement dans les forums.

Les profils et préférences doivent rester modifiables.

La découverte des joueurs doit respecter leur confidentialité et leur choix de visibilité.

### 12.4. Profil GameNight

Un joueur connecté pourra compléter :

- Ses jeux favoris.
- Ses plateformes.
- Ses niveaux.
- Ses disponibilités.
- Ses préférences.
- Son profil communautaire.
- Son classement de jeux ou tier list.
- Son historique de participation lorsque cette information est disponible.

L'inscription et la configuration du profil doivent être rapides.

---

## 13. Soirées et événements GameNight

### 13.1. Soirées

GameNight doit permettre :

- La création de soirées.
- Les propositions de jeux.
- Les disponibilités.
- Les inscriptions.
- Les votes.
- Les rappels.
- Les annonces Discord.
- La coordination des participants.

### 13.2. Calendrier

Un calendrier communautaire doit rendre les prochains événements facilement visibles.

Éviter d'ajouter un deuxième bot de calendrier si GameNight couvre déjà ce besoin.

### 13.3. Tournois

Prévoir :

- Inscriptions.
- Présentation des règles.
- Participants.
- Résultats.
- Annonces.
- Classements adaptés.
- Récompenses éventuelles.

### 13.4. Interfaces proposées

Les idées étudiées comprennent :

- Panneau « Ce soir dans la Tour ».
- Fiches interactives de soirées.
- Bouton de recherche de partie.
- Roulette collective de choix des jeux.
- Calendrier interactif.
- Notifications personnalisées.

Ces interfaces sont des propositions à intégrer seulement si elles apportent une réelle amélioration aux fonctionnalités existantes.

---

## 14. Saisons et classements

### 14.1. Fonctionnement

Les saisons structurent la compétition et la fidélisation.

Elles doivent permettre à un joueur de rejoindre la communauté sans avoir l'impression qu'il est trop tard pour participer.

### 14.2. Calendrier

Le fonctionnement souhaité suit davantage les **trimestres scolaires** que les trimestres civils.

Une saison estivale est également envisagée.

Les dates exactes restent à définir.

### 14.3. Classements

Prévoir :

- Classement individuel.
- Classement d'équipes.
- Classement saisonnier.
- Classement permanent adapté.
- Résultats historiques.
- Distinctions spécifiques.

### 14.4. Réinitialisation

À la fin d'une saison :

- Les scores saisonniers peuvent être remis à zéro.
- Les étages permanents sont conservés.
- L'historique des performances reste disponible.
- Les récompenses déjà obtenues sont gérées selon leurs règles.

Il ne faut pas créer un salon Discord permanent supplémentaire pour chaque saison.

---

## 15. Récompenses et reconnaissance

### 15.1. Récompenses envisagées

- Badges GameNight.
- Titres honorifiques.
- Grades cosmétiques.
- Distinctions de saison.
- Mise en avant dans le Hall of Fame.
- Possibilité de proposer des défis.
- Possibilité de choisir certains événements.
- Distinctions humoristiques.
- Reconnaissance des exploits collectifs.

### 15.2. Principes

Les récompenses doivent renforcer la participation et la fidélisation.

Elles ne doivent pas donner automatiquement des droits administrateur.

Aucun cadeau payant ne doit être promis sans budget disponible.

---

## 16. Le Sommet

Le Sommet représente la reconnaissance des joueurs et équipes les plus remarquables.

Il regroupe notamment :

- Les classements.
- Le Hall of Fame.
- Les Rankers.
- Les défis entre équipes.
- Les distinctions.
- Les exploits marquants.

La publication de classements doit reposer sur de véritables données et non sur une activité simulée.

---

## 17. Salons vocaux et expérience collective

L'expérience vocale doit permettre :

- Les discussions libres.
- Les groupes de jeu.
- La coordination des équipes.
- Les activités communautaires.
- Les événements.

Les salons vocaux temporaires peuvent être envisagés, après vérification des solutions existantes.

Aucun bot supplémentaire ne doit être installé automatiquement lorsque l'infrastructure actuelle suffit.

Le parcours doit rester compréhensible et simple sur ordinateur comme sur mobile.

---

## 18. Bots et systèmes historiques

### 18.1. Principe

**Réutiliser et améliorer avant de remplacer.**

Les bots existants doivent être analysés selon leurs fonctions réelles.

### 18.2. YAGPDB

Préserver et moderniser les fonctions existantes de validation et de sélection des rôles.

Ne pas créer un second parcours de rôles concurrent.

### 18.3. Atlas

Préparer le remplacement de l'ancienne attribution des étages par la progression GameNight.

Conserver ses autres fonctions utiles après vérification.

### 18.4. Ticket Tool

Réparer et réutiliser le panneau historique de demandes d'assistance.

Ne pas créer un deuxième système de tickets.

### 18.5. Appy

Conserver son rôle dans les candidatures lorsqu'il fonctionne.

Éviter de confondre les candidatures avec les tickets d'assistance.

### 18.6. Modération

Auditer les fonctions existantes avant de choisir les mécanismes définitifs.

L'objectif est une modération cohérente, et non l'accumulation de plusieurs bots réalisant les mêmes actions.

---

## 19. Sécurité, permissions et confidentialité

### 19.1. Sécurité Discord

Prévoir :

- Permissions cohérentes.
- Vérification des administrateurs.
- Protection des salons privés.
- Protection contre le spam.
- Protection anti-raid.
- Modération.
- Journalisation des opérations sensibles.
- Contrôle des bots et applications.

### 19.2. Permissions

Les rôles de prestige doivent être séparés des rôles techniques et administratifs.

Les modifications de permissions sensibles doivent être vérifiées avant application.

### 19.3. Confidentialité

Les données privées des membres et leurs preuves ne doivent pas être diffusées sans justification.

Les tickets et journaux de modération doivent conserver leur confidentialité.

### 19.4. Anti-abus

Les fonctions GameNight doivent notamment éviter :

- Récompenses multiples.
- Votes frauduleux.
- Défis validés deux fois.
- Participation artificielle.
- Exploitation des interactions Discord.
- Accès d'une communauté aux données d'une autre.

---

## 20. Intelligence artificielle et extensions futures

Plusieurs idées ont été étudiées, sans devenir des obligations du lancement.

### 20.1. Concierge IA

Assistant communautaire pour orienter les membres et répondre aux questions.

**Statut : option future.**

### 20.2. IA pour les contenus

Aide à produire des textes, idées de défis et visuels.

**Statut : optionnel.**

### 20.3. Validation IA des preuves

**Non retenue pour la version initiale.**

### 20.4. Discord Activities

Éventuelle interface interactive pour certains jeux, votes ou activités GameNight.

**Statut : proposition future, non obligatoire.**

### 20.5. Améliorations visuelles

Tags communautaires, styles avancés, bannières et autres avantages Discord.

**Statut : options futures, ne devant pas conditionner le lancement gratuit.**

---

## 21. Architecture technique

### 21.1. Réutilisation de l'existant

Le projet doit s'appuyer sur GameNight et son architecture actuelle.

Ne pas créer un système parallèle de profils, équipes ou progression lorsque l'application possède déjà une base appropriée.

### 21.2. Bot Discord

Le bot GameNight doit être le moteur privilégié des nouvelles interactions :

- Commandes.
- Boutons.
- Menus.
- Défis.
- Preuves.
- Votes.
- Progression.
- Événements.
- Notifications.

### 21.3. Base de données

La base doit stocker les informations nécessaires :

- Membres liés à Discord.
- Équipes.
- Défis.
- Attributions.
- Preuves.
- Votes.
- Récompenses.
- Étages.
- Saisons.
- Classements.
- Historiques utiles.

Les opérations sensibles doivent être idempotentes et résistantes aux exécutions concurrentes.

### 21.4. Migrations

Aucune migration de production sans :

- Vérification de la structure actuelle.
- Sauvegarde.
- Tests.
- Procédure de retour arrière.
- Validation de la bascule.

Les PR #325 et #329 doivent être examinées et réutilisées plutôt que dupliquées.

### 21.5. Environnements

Distinguer clairement :

- Développement.
- Prévisualisation.
- Production.
- Configurations Discord.
- État réel des fonctionnalités.

Les données de production ne doivent pas être utilisées comme données de test.

---

## 22. Fiabilité, contrôles et qualité

### 22.1. Exigences générales

Chaque fonctionnalité doit être :

- Testable.
- Documentée.
- Vérifiable.
- Cohérente avec les permissions.
- Résistante aux doubles actions.
- Compatible avec les usages mobiles lorsque pertinent.
- Sans effet involontaire sur les autres communautés GameNight.

### 22.2. Tests critiques

Les tests doivent notamment couvrir :

- Limite de 12 heures entre deux attributions solo.
- Expiration des défis à 48 heures.
- Deux réussites maximum par jour.
- Votes de 24 heures.
- Minimum de trois votants.
- Majorité réelle.
- Égalités et absence de quorum.
- Contestations.
- Récompense attribuée une seule fois.
- Attributions simultanées.
- Permissions.
- Isolation des communautés.
- Bascule depuis les anciens étages.

### 22.3. Vérification réelle

La présence d'un code dans GitHub ne prouve pas qu'une fonction est active.

La réussite d'un déploiement Vercel ne prouve pas qu'une commande fonctionne dans Discord.

Les vérifications doivent donc porter sur le résultat réel.

---

## 23. Priorités de réalisation

### Phase 1 — Fondation communautaire

- Organisation claire du serveur.
- Identité visuelle.
- Accueil.
- Règlement.
- Rôles et accès.
- Forums et parcours de découverte.
- Réutilisation des outils historiques.

### Phase 2 — Fonctionnalités sociales

- Recherche de joueurs.
- Profils et préférences.
- Équipes.
- Recrutement.
- Soirées GameNight.
- Calendrier et notifications.

### Phase 3 — Nouvelle Ascension

- Remplacement de l'ancien système d'étages.
- Progression infinie.
- Défis solo et collectifs.
- Preuves.
- Votes.
- Contestations.
- Anti-abus.
- Récompenses.

### Phase 4 — Saisons et fidélisation

- Classements.
- Saisons.
- Hall of Fame.
- Compétitions d'équipes.
- Distinctions.
- Animation automatique.

### Phase 5 — Lancement public

- Première saison prête.
- Catalogue initial de défis.
- Guide et règles exacts.
- Tests de bout en bout.
- Sécurité vérifiée.
- Parcours réel d'un nouveau membre.
- Événements de lancement.
- Suivi des incidents et améliorations.

---

## 24. Lancement et développement communautaire

La communauté doit être ouverte au public lorsqu'elle offre une expérience cohérente et utilisable.

Le développement pourra ensuite s'appuyer sur :

- Soirées hebdomadaires.
- Tournois.
- Défis.
- Recrutement d'équipes.
- Créateurs de contenu.
- Partenariats gaming.
- Réseaux sociaux.
- Vidéos courtes.
- Recommandations entre joueurs.
- Fidélisation et réputation communautaires.

Le serveur doit encourager la récurrence sans devenir oppressant.

Les notifications doivent être configurables.

La croissance ne doit pas se faire au détriment de la qualité de l'expérience.

---

## 25. Conditions de livraison finale

Le projet The Tower 2.0 sera considéré comme terminé pour son lancement lorsque les conditions suivantes seront satisfaites :

1. Le serveur possède une identité visuelle et une navigation cohérentes.
2. L'accueil et l'accès d'un véritable nouveau membre fonctionnent.
3. Les systèmes existants de tickets, rôles et modération sont réutilisés ou remplacés proprement.
4. Les grades et les permissions sont cohérents.
5. La nouvelle Ascension fonctionne sans double progression.
6. Les anciens rôles Etage inutiles ont été retirés après migration contrôlée.
7. Les défis solo et collectifs fonctionnent.
8. Les preuves, votes et contestations fonctionnent conformément aux règles.
9. Les quotas et l'anti-abus sont testés.
10. Les équipes et forums sont opérationnels.
11. Les soirées et événements GameNight sont intégrés.
12. Les classements, saisons et récompenses fonctionnent.
13. La première saison possède son catalogue et son calendrier.
14. Les données et permissions sont protégées.
15. Les déploiements sont validés et vérifiés sur Discord.
16. Les fonctions facultatives non développées sont clairement identifiées.
17. Aucun faux état d'avancement n'est présenté comme une livraison.

La conformité doit être établie à partir de preuves techniques et fonctionnelles.

---

## 26. Décisions encore ouvertes dans le cahier initial

Les points suivants n'avaient pas tous été définitivement tranchés :

- Barème exact des étages par difficulté.
- Seuils de prestige Ranker et High Ranker.
- Couleurs et présentation définitives des grades.
- Règles de création et de composition des équipes.
- Nombre d'équipes autorisées par joueur.
- Modalités détaillées de contestation.
- Gestion des votes sans quorum.
- Catalogue de défis de la première saison.
- Horaires d'attribution quotidienne.
- Dates exactes des saisons scolaires et estivales.
- Règles de départage des classements.
- Récompenses exactes et durée des avantages saisonniers.
- Fonctionnement définitif de l'onboarding.
- Calendrier du lancement.
- Choix des extensions facultatives.

Ces éléments doivent être résolus avant leur mise en production lorsqu'ils ont un impact sur les règles ou les données.

Les choix ordinaires de présentation et d'ergonomie peuvent être proposés et réalisés sans remettre en question toute l'architecture.

---

# CONCLUSION

The Tower 2.0 doit devenir une plateforme communautaire multigaming complète, combinant :

**Discord pour la vie communautaire, GameNight pour l'organisation et la persistance des données, et l'Ascension pour l'engagement et la fidélisation.**

L'expérience doit être accessible, moderne, immersive, amusante, compétitive et durable.

Le projet ne se limite pas à créer des salons ou des bots supplémentaires.

Il doit intégrer intelligemment les outils déjà présents pour offrir une expérience cohérente, automatisée et réellement fonctionnelle.

**La réussite du projet sera jugée sur l'expérience vécue par les membres, pas sur le nombre de fonctionnalités annoncées ou de lignes de code produites.**
