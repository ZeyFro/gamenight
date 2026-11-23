# Messages à publier dans chaque salon Discord

Un message court par salon, prêt à copier-coller, en français simple. Chaque message dit : à quoi sert le salon, quelles commandes GameNight taper (exactes), et le lien du site quand la page existe. **8 lignes au maximum par message**, sauf `commandes-bot` (liste des 13 commandes, en deux messages à cause de la limite de 2 000 caractères de Discord).

## Comment s'en servir

- Copier le contenu d'un bloc (sans les trois ou quatre accents graves qui l'entourent) et le coller dans le salon.
- Les noms de salons écrits sans lien (`#général`) deviennent cliquables si on retape `#` et qu'on choisit le salon dans la liste au moment de coller.
- Les commandes sont entre accents graves : Discord les affiche en police fixe. Les valeurs entre `<…>` sont à remplacer : la **référence** d'une soirée, d'un tournoi ou d'une annonce s'affiche dans le résultat de `/soiree liste`, `/tournoi liste` ou `/joueurs mes-annonces`.
- Adresse du site : `https://gamenight-zeyfro.vercel.app`.

## Ce qui a été vérifié (et ce qui dépend d'une activation)

- **Commandes** : lues dans `scripts/discord-commands.json` (13 entrées : 12 commandes `/…` et « Signaler » par clic droit), nom, sous-commandes et options exacts. La description de chaque commande est celle du manifeste. Aucune commande inventée.
- **Valeurs du niveau** de `/joueurs chercher` : `DEBUTANT`, `INTERMEDIAIRE`, `AVANCE`, `EXPERT` (sans accent, en majuscules).
- **Pages du site** : chaque lien correspond à un dossier existant de `src/app`.
- **Activation** : plusieurs fonctions sont éteintes par défaut. Une commande dont la fonction est éteinte répond « en attente d'activation » (`/aide` donne l'état de chacune) ; une page derrière un interrupteur (`/ce-soir`, `/projets`, rivalités d'équipe, calendrier à abonnement, `/profil/personnalisation`, `/profil/lore`) ne s'ouvre pas tant qu'il n'est pas allumé. Publier un message n'allume rien : vérifier `/aide` avant.
- **À confirmer par le staff avant publication** : (1) le panneau « Aide privée » de `#requête` (Ticket Tool, état « actif non identifié » dans `docs/PLAN_SERVEUR_DISCORD.md`) ; (2) le mécanisme exact de validation du règlement (YAGPDB) ; (3) les votes par boutons ✅/❌ de `épreuves` (`TOWER_DISCORD_VOTES_ENABLED`) et la règle « 3 jours de présence » (PR #578) ; (4) ce que le bot publie réellement dans `chroniques-de-la-tour` (le plan dit seulement « écriture bot GameNight et staff »).
- `docs/DISCORD_COMMANDES.md` est tenu à jour avec le même manifeste.

---

## 🏰 LE PORTAIL

### 👋 bienvenue

````
👋 **Bienvenue sur The Tower !** Ici, on joue ensemble : soirées, tournois, équipes et l'Ascension.
1️⃣ Lis le règlement et valide-le pour obtenir le rôle **Régulars**.
2️⃣ Présente-toi dans #présentations.
3️⃣ Tape `/aide` dans #commandes-bot pour voir ce que le bot sait faire.
Le site GameNight est facultatif pour discuter. Il sert aux soirées, tournois, équipes et à ta progression :
🌐 https://gamenight-zeyfro.vercel.app/bienvenue
````

### 📢 annonces

````
📢 **Annonces officielles** du staff : nouveautés, événements, changements de règles.
Ce salon est en lecture seule : rien à écrire ici.
💬 Pour réagir ou poser une question, va dans #général.
🤖 Pour les commandes du bot : #commandes-bot, puis tape `/aide`.
````

### 📜 règlement

````
📜 **Règlement du serveur** : lis-le en entier, il est court.
Une fois lu, valide-le pour obtenir le rôle **Régulars** et accéder aux salons.
Aucune commande ici. Une question ? Va dans #requête.
Un message qui enfreint le règlement ? Clic droit sur le message → Applications → **Signaler**.
Le staff est prévenu en privé. Aucune sanction n'est automatique.
````

### 🎭 choisir-ses-rôles

````
🎭 **Choisis tes rôles** pour être prévenu des jeux qui t'intéressent (le panneau est géré par YAGPDB).
Tu peux aussi le faire avec le bot, dans #commandes-bot :
`/role chercher jeu:Deadlock` : voir si le rôle existe
`/role attribuer jeu:Deadlock` : recevoir le rôle
`/role creer jeu:Deadlock` : créer le rôle de jeu, puis le recevoir
`/role retirer jeu:Deadlock` : retirer ton rôle
Un rôle de jeu ne donne aucun pouvoir : il sert seulement à se retrouver.
````

### 📖 guide-de-la-tour

````
📖 **Le guide de la Tour** : comment ça marche, de la première connexion à l'Ascension.
🧗 Défis, preuves et étages : `/tower defi` puis `/tower progression`
👤 Ton résumé (niveau d'XP, rang, badges, équipes) : `/profil`
📚 Toutes les commandes : `/aide`
🌐 Guide complet : https://gamenight-zeyfro.vercel.app/guide
🗼 L'Ascension : https://gamenight-zeyfro.vercel.app/ascension
````

### 📩 requête

````
📩 **Requête** : une question ou un souci que tu ne veux pas poser en public ?
Utilise le panneau « Aide privée » de ce salon : un ticket s'ouvre, seul le staff le voit.
Aucune commande GameNight ici.
Un bug sur le site ou le bot ? Écris-le plutôt dans #retours-bugs.
Un message à signaler ? Clic droit → Applications → **Signaler**.
````

---

## 💬 LE HALL DES RÉGULIERS

### 💬 général

````
💬 **Général** : discute de tout, jeux ou pas, avec les Régulars.
Reste respectueux : le règlement s'applique ici comme ailleurs.
Pas de commande à taper ici : les commandes du bot vont dans #commandes-bot.
Tu cherches avec qui jouer ce soir ? Va dans #qui-joue-ce-soir.
🌐 Le site : https://gamenight-zeyfro.vercel.app
````

### 🎮 qui-joue-ce-soir

````
🎮 **Qui joue ce soir ?** Dis à quoi tu joues et à quelle heure (heure de Paris).
Annonce-toi avec le bot (24 h) : `/joueurs publier jeu:Deadlock description:Dispo dès 21h, micro, ambiance détente`
Voir les annonces : `/joueurs annonces` · Voir les tiennes : `/joueurs mes-annonces`
Une soirée organisée ? `/soiree liste`, ou crée-la : `/soiree creer jeu:Deadlock date:2026-12-05 heure:20:30 places:5`
🌐 Qui joue ce soir : https://gamenight-zeyfro.vercel.app/ce-soir
````

### 🙋 présentations

````
🙋 **Présentations** : dis-nous qui tu es en quelques lignes.
Ton pseudo, tes jeux préférés, ta plateforme (PC, PlayStation, Xbox, Switch) et tes horaires de jeu.
Pour voir ton résumé GameNight : `/profil`
Tu peux compléter ton profil sur le site : https://gamenight-zeyfro.vercel.app/profil
Bienvenue, et bon jeu !
````

### 🐞 retours-bugs

````
🐞 **Retours et bugs** : quelque chose ne marche pas sur le site ou avec le bot ?
Écris : 1) la page ou la commande, 2) ce que tu as fait, 3) ce qui s'est passé, 4) téléphone ou ordinateur.
Ajoute une capture d'écran si tu peux (sans information personnelle).
Aucune commande pour ça : un message suffit, le staff le lira.
Pour signaler le MESSAGE d'un membre (pas un bug) : clic droit → Applications → **Signaler**.
````

### 🤖 commandes-bot

Liste complète des 13 commandes (12 commandes `/…` plus « Signaler »), en **deux messages** (limite de 2 000 caractères par message de Discord) : c'est le seul salon qui dépasse 8 lignes, comme demandé.

**Message 1 sur 2**

````
🤖 **Commandes GameNight (1/2)** : tape `/` puis le nom de la commande. `/aide` montre lesquelles sont actives (« en attente d'activation » = pas encore ouverte).
**Pour tous**
`/aide` : la liste des commandes et leur état
`/profil` : ton niveau d'XP, ton rang, tes étages, tes badges et tes équipes
`/boost` : tes avantages de Booster Discord
`/role chercher | attribuer | creer | retirer` : gérer tes rôles de jeu. Ex. `/role attribuer jeu:Valheim`
`/tower defi | progression | classement | vote | equipe` : ton défi, tes étages et ta preuve, le classement du trimestre, le vote du champion, le défi d'équipe du jour
`/equipe liste | moi | rejoindre` : les équipes qui recrutent, ton équipe, rejoindre une équipe. Ex. `/equipe rejoindre equipe_id:<identifiant>`
`/soiree liste | voir | creer | rejoindre | quitter` : les soirées. Ex. `/soiree creer jeu:Deadlock date:2026-12-05 heure:20:30 places:5`
````

**Message 2 sur 2**

````
🤖 **Commandes GameNight (2/2)**
`/tournoi liste | voir | inscription | desinscription | mes-inscriptions` : les tournois. Ex. `/tournoi inscription tournoi:<référence>`
`/joueurs annonces | chercher | mes-annonces | publier | retirer` : trouver des partenaires. Ex. `/joueurs chercher jeu:Deadlock niveau:INTERMEDIAIRE`
`/projet liste | voir | rejoindre | quitter | creer | recrutement | espace` : projets de 2 à 8 joueurs. Ex. `/projet creer nom:Ferme jeu:Valheim objectif:Construire un village plateforme:PC places:4`
**Signaler un message** : clic droit sur le message → Applications → **Signaler**. Le staff est prévenu en privé, sans sanction automatique.
**Réservé à la modération**
`/gamenight setup` : activer GameNight sur le serveur
`/tower-admin ajouter | ajouter-mesure | defis | desactiver | importer | importer-equipe` : gérer le catalogue des défis
````

---

## 🎲 LES ÉPREUVES GAMENIGHT

### 📢 annonces-gamenight

````
📢 **Annonces GameNight** : le bot y publie les nouvelles soirées et les nouveaux tournois.
Lecture seule : discute dans le fil de l'annonce.
S'inscrire : `/soiree rejoindre soiree:<référence>` ou `/tournoi inscription tournoi:<référence>`
Les références s'affichent avec `/soiree liste` et `/tournoi liste`.
🎲 Soirées : https://gamenight-zeyfro.vercel.app/sessions
🏆 Tournois : https://gamenight-zeyfro.vercel.app/tournois
````

### 🎮 soirées

````
🎮 **Soirées** : organise ou rejoins une soirée jeux avec les Régulars.
Les voir : `/soiree liste` · Le détail : `/soiree voir soiree:<référence>`
Rejoindre : `/soiree rejoindre soiree:<référence>` · Quitter : `/soiree quitter soiree:<référence>`
En créer une : `/soiree creer jeu:Deadlock date:2026-12-05 heure:20:30 places:5` (places : facultatif)
La date s'écrit AAAA-MM-JJ et l'heure HH:mm.
🌐 Disponibilités, vote du jeu, inscription : https://gamenight-zeyfro.vercel.app/sessions
````

### 🏆 tournois

````
🏆 **Tournois** : inscris-toi, suis le bracket, joue ton match.
Les voir : `/tournoi liste` · Le détail : `/tournoi voir tournoi:<référence>`
S'inscrire : `/tournoi inscription tournoi:<référence>`
Se désinscrire : `/tournoi desinscription tournoi:<référence>` · Tes tournois : `/tournoi mes-inscriptions`
🌐 Créer un tournoi et voir le bracket : https://gamenight-zeyfro.vercel.app/tournois
````

### 📅 calendrier

````
📅 **Calendrier** : toutes les soirées et tous les tournois à venir, au même endroit.
Pas de commande dédiée : dans Discord, `/soiree liste` et `/tournoi liste` donnent les mêmes dates.
Sur le site, tu peux aussi ajouter le calendrier à ton agenda (si l'abonnement est activé).
🌐 https://gamenight-zeyfro.vercel.app/calendrier
````

### 🎯 défis-communautaires

````
🎯 **Défis communautaires** : relève des défis The Tower pour gagner des étages.
Recevoir ton défi : `/tower defi`
Voir tes étages et déposer ta preuve : `/tower progression`
Défi d'équipe du jour : `/tower equipe`
Les preuves sont votées par les membres présents depuis au moins 3 jours.
🌐 https://gamenight-zeyfro.vercel.app/tower
````

### 📸 photos-soirées

````
📸 **Photos des soirées** : partage tes photos et tes captures de soirée.
Avant de poster : demande l'accord des personnes visibles ou audibles. Elles peuvent demander le retrait à tout moment.
Aucune commande ici. Les photos restent sur Discord, pas sur le site.
Un souci avec une photo ? Clic droit sur le message → Applications → **Signaler**, ou écris au staff.
🌐 Le lien vers ce salon est sur la page de chaque soirée : https://gamenight-zeyfro.vercel.app/sessions
````

---

## ⚔️ LE HALL DES ÉQUIPES (forums)

### 🔎 recherche-de-joueurs

````
🔎 **Recherche de joueurs** (forum) : crée un post et choisis le tag qui correspond (plateforme).
Écris : le jeu, ta plateforme, tes horaires (heure de Paris), micro oui/non, taille du groupe, style de partie.
Ou publie une annonce de 24 h avec le bot : `/joueurs publier jeu:Deadlock description:Cherche 2 joueurs ce soir, micro`
Chercher : `/joueurs chercher jeu:Deadlock niveau:INTERMEDIAIRE` · `/joueurs annonces` · `/joueurs mes-annonces`
Retirer une annonce : `/joueurs retirer annonce:<référence>`
🌐 https://gamenight-zeyfro.vercel.app/joueurs
````

### 🛡️ recrutement-équipes

````
🛡️ **Recrutement d'équipes** (forum) : ton équipe cherche des joueurs ? Crée un post avec le bon tag.
Écris : le jeu, l'objectif (détente, compétitif…), les horaires (heure de Paris), le niveau demandé, le nombre de places.
Voir les équipes qui recrutent : `/equipe liste` · Ton équipe : `/equipe moi`
Rejoindre : `/equipe rejoindre equipe_id:<identifiant donné par /equipe liste>`
🌐 Créer et gérer ton équipe : https://gamenight-zeyfro.vercel.app/equipes
````

### 🌍 projets-et-aventures

````
🌍 **Projets et aventures** (forum) : coop, construction, exploration, survie, événements.
Écris : le jeu, l'objectif, la plateforme, le nombre de joueurs voulu (2 à 8).
Avec le bot : `/projet liste` · `/projet voir projet:<nom>` · `/projet rejoindre projet:<nom>` · `/projet quitter projet:<nom>`
Créer : `/projet creer nom:Ferme jeu:Valheim objectif:Construire un village plateforme:PC places:4`
Capitaine : `/projet recrutement projet:<nom> ouvert:true` · `/projet espace projet:<nom>` (salons privés)
🌐 Équipes : https://gamenight-zeyfro.vercel.app/equipes · Projets avec un organisateur : https://gamenight-zeyfro.vercel.app/projets
````

### 🏆 équipes-et-guildes

````
🏆 **Équipes et guildes** : présente ton équipe ou ta guilde et suis celles des autres.
Ton équipe : `/equipe moi` · Les équipes qui recrutent : `/equipe liste`
Pour rejoindre : `/equipe rejoindre equipe_id:<identifiant>`
Sur le site : créer ton équipe (2 à 8 joueurs), gérer les membres, voir les rivalités.
🌐 https://gamenight-zeyfro.vercel.app/equipes
````

---

## 🗼 L'ASCENSION

### 📖 comment-gravir-la-tour

````
📖 **Comment gravir la Tour** : chaque défi réussi te fait gagner des **étages**, sans limite.
1️⃣ Reçois un défi : `/tower defi`
2️⃣ Réalise-le, puis dépose ta preuve : `/tower progression`
3️⃣ Les membres votent ; si c'est validé, tu gagnes tes étages.
Tes étages sont séparés de ton niveau d'XP (celui des soirées et des tournois).
🌐 https://gamenight-zeyfro.vercel.app/ascension · Guide : https://gamenight-zeyfro.vercel.app/guide
````

### ⚡ épreuves

````
⚡ **Épreuves** : le bot y publie les preuves déposées et les réussites.
Pour voter ✅ ou ❌ : il faut être sur le serveur depuis au moins 3 jours, et on ne vote pas pour sa propre preuve.
Un doute ? Discute dans le fil de la preuve.
Ton défi : `/tower defi` · Ta preuve et tes étages : `/tower progression`
Défi d'équipe du jour : `/tower equipe`
🌐 https://gamenight-zeyfro.vercel.app/tower
````

### 🏅 progression-et-rangs

````
🏅 **Progression et rangs** : ton niveau d'XP et ton rang viennent de tout ce que tu fais (soirées, tournois, votes…).
Ton résumé : `/profil` · Tes étages Tower : `/tower progression`
Le classement du trimestre : `/tower classement`
Les rangs : Bronze, Argent, Or, Platine, Diamant, Légende.
🌐 Classement : https://gamenight-zeyfro.vercel.app/classement
🌐 Ton profil : https://gamenight-zeyfro.vercel.app/profil
````

### 🎁 récompenses

````
🎁 **Récompenses** : titres, cadres et couleurs de profil gagnés en montant la Tour.
Elles sont purement cosmétiques : aucun pouvoir de modération, aucun avantage de jeu.
Voir les tiennes : `/profil` · Avantages de Booster Discord : `/boost`
🌐 Personnaliser ton profil : https://gamenight-zeyfro.vercel.app/profil/personnalisation
🌐 Mur des soutiens : https://gamenight-zeyfro.vercel.app/soutiens
````

### 📜 chroniques-de-la-tour

````
📜 **Chroniques de la Tour** : les histoires et les temps forts du serveur, publiés par GameNight et le staff.
Lecture seule : rien à écrire ni à taper ici.
Tu peux écrire la chronique d'une de tes soirées terminées sur le site, dans ton profil (onglet Lore).
🌐 https://gamenight-zeyfro.vercel.app/profil/lore
````

---

## 👑 LE SOMMET

### 🏆 classements

````
🏆 **Classements** : les meilleurs de la Tour, mis à jour par le bot.
Classement du trimestre : `/tower classement`
Voter pour le champion du dernier trimestre : `/tower vote`
Lecture seule : discute des résultats dans #général.
🌐 Classement : https://gamenight-zeyfro.vercel.app/classement · Saisons : https://gamenight-zeyfro.vercel.app/saisons
````

### ⭐ hall-of-fame

````
⭐ **Hall of fame** : les champions et les records de la Tour.
Lecture seule : rien à taper ici (seulement des résultats réels).
Le classement en cours : `/tower classement`
🌐 https://gamenight-zeyfro.vercel.app/classement
````

### ⚔️ défis-entre-équipes

````
⚔️ **Défis entre équipes** : ton équipe contre une autre, résultat confirmé par les deux capitaines.
Défi d'équipe du jour : `/tower equipe`
Ton équipe : `/equipe moi` · Équipes qui recrutent : `/equipe liste`
Le capitaine propose un défi sur la page de son équipe (rivalités) ; l'autre capitaine l'accepte ou le refuse.
🌐 https://gamenight-zeyfro.vercel.app/equipes
````
