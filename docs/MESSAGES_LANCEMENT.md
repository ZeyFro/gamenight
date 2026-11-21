# Messages de lancement — textes prêts à relire et à coller

> **Brouillon à relire par Maxime.** Ce document n'écrit rien sur Discord, ne touche aucune variable Vercel et ne promet aucune date non décidée. Chaque bloc fait moins de 2 000 caractères (limite d'un message Discord) : un bloc = un message.
>
> Dates décidées et reprises ici : lancement la **semaine du 1er décembre 2026**, **saison 1 du 1er décembre 2026 au 31 mars 2027**. Rien d'autre n'est daté.
>
> Règle d'or, reprise de [LANCEMENT_DISCORD.md](LANCEMENT_DISCORD.md) : **ne jamais présenter une fonction éteinte comme disponible.** Avant de coller, retirer toute ligne dont la fonction n'est pas active (contrôle avec `/aide` et [PHASE_TEST.md](PHASE_TEST.md)). Les `[CROCHETS]` sont à remplacer ou à supprimer. **Aucune mention `@everyone` ailleurs qu'au bloc (a).**
>
> Contexte de calendrier et de décision : [SEMAINE_1.md](SEMAINE_1.md). Règles de modération : [GUIDE_MODERATION.md](GUIDE_MODERATION.md).

## (a) Annonce d'ouverture (seule mention `@everyone` autorisée)

À publier **seulement** quand le point de contrôle « ouverture générale » de [SEMAINE_1.md](SEMAINE_1.md) est vert, dans le salon d'annonces **[À COMPLÉTER : nom du salon]**.

### Variante 1 — sobre

```
@everyone

L'Ascension de The Tower ouvre.

La saison 1 court du 1er décembre 2026 au 31 mars 2027. Tu peux jouer avec nous, organiser des soirées, t'inscrire à des tournois et, si tu le veux, grimper la Tour en relevant des défis et en gagnant des étages.

GameNight (le site) sert aux soirées, aux équipes, à ta progression et aux inscriptions. Il est réservé aux membres de ce serveur : connecte-toi avec ton compte Discord.

Tout est expliqué dans [#guide-de-la-tour : nom du salon à vérifier]. Un souci, une question ou un message à signaler : voir le message d'accueil, ou écris au staff.

Bon jeu à tous.
```

### Variante 2 — plus chaleureuse

```
@everyone

C'est parti : la saison 1 de The Tower commence.

Du 1er décembre 2026 au 31 mars 2027, on joue ensemble : soirées, tournois, équipes, et l'Ascension pour celles et ceux qui aiment les défis. Rien n'est obligatoire, viens à ton rythme.

Pour t'inscrire à une soirée ou relever un défi, connecte-toi à GameNight avec ton compte Discord (accès réservé aux membres du serveur). Le guide t'attend dans [#guide-de-la-tour : nom du salon à vérifier].

On compte sur ta bonne humeur, et le staff est là si quelque chose cloche.

À très vite en vocal.
```

> Avant de coller : retirer toute fonction non active (défis d'équipe, par exemple, tant que `TOWER_TEAM_DAILY_ENABLED` n'est pas décidé). Aucun de ces textes ne cite de fonction facultative.

## (b) Message d'accueil des nouveaux

À publier dans le salon d'accueil **[À COMPLÉTER]**, sans mention collective.

```
Bienvenue sur The Tower !

Ici, on joue ensemble : soirées, tournois, équipes et, si tu veux, l'Ascension (des défis qui font gagner des étages). Tu peux simplement discuter et jouer avec nous, sans rien installer.

Se connecter à GameNight (le site)
L'accès est réservé aux membres du serveur Discord The Tower. Connecte-toi avec ton compte Discord. Pas encore sur le serveur ? Rejoins-le ici : https://discord.gg/kb3sGuPBZH

Où trouver quoi
- Le guide : [#guide-de-la-tour : nom du salon à vérifier] et la page « Guide » du site.
- La liste des commandes du bot et leur état : tape /aide.

Signaler un problème ou un message
- Clic droit sur le message, puis Applications, puis « Signaler » : le staff le reçoit en privé. [À retirer tant que cette commande n'est pas active]
- Sinon, écris au staff : [À COMPLÉTER : salon d'aide, ticket ou rôle à mentionner].

Respect, pas de spam, pas de triche sur les défis. Le staff est là pour t'aider.
```

## (c) Consigne Steam : mettre son profil en public

> **Libellés Steam à vérifier** : les noms exacts des menus changent selon la langue et les mises à jour de Steam. Les relire sur un vrai compte avant de coller.
>
> À publier **seulement si** `TOWER_STEAM_AUTOVALIDATE_ENABLED` est actif et qu'au moins un défi « mesurable Steam » existe au catalogue. Sinon, ne pas publier.

```
Défis mesurés sur Steam : mets ton profil en public

Certains défis (temps de jeu, succès Steam) se valident automatiquement : le bot lit ton temps de jeu ou tes succès via l'API officielle de Steam. Pour que ça marche, ton profil Steam doit être lisible, et ton compte Steam lié dans GameNight (c'est facultatif).

Comment faire (libellés Steam à vérifier) :
1. Dans Steam : ton Profil, puis « Modifier le profil ».
2. Ouvre « Paramètres de confidentialité ».
3. Mets « Mon profil » sur « Public ».
4. Mets « Détails des jeux » (ou « Détails du jeu ») sur « Public ».
5. Si Steam propose de masquer ton temps de jeu total même quand les détails sont publics, décoche cette option.

Pourquoi : un profil privé empêche la lecture automatique. Rien n'est bloqué pour autant : tu déposes une preuve (capture ou description), la communauté vote, comme pour les autres défis. Si une validation automatique te paraît douteuse, le bouton « Signaler un doute » renvoie le défi au vote.

Aucune IA ne valide un défi. Tu peux remettre ton profil en privé quand tu n'as plus de défi mesuré en cours.
```

## (d) Version corrigée du message du guide

Le message du guide qui disait « Tes étages actuels restent en place » est faux : les rôles « Étage » ont été supprimés et le compteur Tower démarre de zéro. Ce message a été publié à la main et son texte complet n'est pas dans le dépôt ; ci-dessous, la **phrase de remplacement** (reprise **mot pour mot** de `src/lib/launch-texts.ts`, constante `TOWER_FLOORS_RESET_NOTICE`, et de [SOIREE_ACTIVATION.md § 4 bis](SOIREE_ACTIVATION.md), décision du 18/11/2026 ; ne pas la reformuler sans nouvelle décision) et un petit bloc prêt à coller si tu préfères republier la partie concernée.

**Phrase à substituer à « Tes étages actuels restent en place » :**

> Ton niveau, ton étage XP et ton rang XP sont conservés ; tes étages Tower repartent de zéro et se gagnent par les défis, et ton grade Tower (Régulars, Irregular, Ranker, High Ranker) repart avec eux.

**Bloc prêt à coller (complément ou remplacement de la section « mes étages ») :**

```
Et mes anciens étages ?

Ton niveau, ton étage XP et ton rang XP sont conservés ; tes étages Tower repartent de zéro et se gagnent par les défis, et ton grade Tower (Régulars, Irregular, Ranker, High Ranker) repart avec eux.

Les étages Tower se gagnent désormais par les défis : facile +1 étage, moyen +2, difficile +3. Une fois gagnés, ils sont permanents.
```

> Contrôle : éditer le message existant plutôt que d'en publier un second, et relire le reste du guide pour toute autre phrase qui promettrait de reprendre d'anciens étages.

## (e) Panne, maintenance et fin d'incident

Jamais de mention `@everyone` pour un incident. À publier dans le salon d'annonces ou d'état **[À COMPLÉTER]**. Aucune heure de retour n'est promise : remplacer `[HEURE]` seulement par une information vraie, ou retirer la ligne.

### Panne en cours

```
Information : GameNight rencontre un problème

Depuis [HEURE], le site ou certaines fonctions (inscriptions, défis, annonces) peuvent être indisponibles ou lents. Nous cherchons la cause.

Le serveur Discord, les salons vocaux et les soirées déjà prévues ne dépendent pas de cet incident : tu peux continuer à jouer avec les autres comme d'habitude.

Inutile de réessayer en boucle ou de refaire une inscription : nous écrivons ici dès que c'est réglé.
```

> Si une donnée personnelle est peut-être concernée, **ne pas utiliser ce modèle** : le message se rédige avec Maxime et, au besoin, un juriste.

### Maintenance prévue

```
Information : maintenance de GameNight

GameNight sera brièvement indisponible [le JOUR à partir de HEURE, durée estimée : À COMPLÉTER]. Pendant ce temps, les soirées et les vocaux fonctionnent normalement sur Discord.

Si une inscription ou une preuve ne passe pas, réessaie un peu plus tard. Merci de ta patience.
```

### Fin d'incident

```
Information : c'est réglé

GameNight fonctionne de nouveau normalement depuis [HEURE].

Ce qui s'est passé : [UNE PHRASE FACTUELLE, À COMPLÉTER].
Ce que tu dois faire : [rien / refaire ton action X, À COMPLÉTER].

Si quelque chose te semble encore anormal (annonce en double, inscription manquante, défi qui ne s'affiche pas), dis-le au staff : [À COMPLÉTER : salon d'aide ou ticket].

Merci pour ta patience.
```

## Contrôles avant tout collage

1. Chaque ligne correspond à une fonction **active** (`/aide`, [PHASE_TEST.md](PHASE_TEST.md)).
2. Le lien d'invitation est exactement `https://discord.gg/kb3sGuPBZH` ; aucun autre lien, nom, e-mail ou identifiant n'a été ajouté sans validation de Maxime.
3. Aucun secret, identifiant privé ou lien d'administration.
4. Longueur sous 2 000 caractères par message ; test d'affichage sur mobile.
5. `@everyone` uniquement dans le bloc (a), après accord de Maxime.
