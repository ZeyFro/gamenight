# Interface GameNight — intégration du prototype approuvé

Base : `main` après la PR #202 (`5482c76`). Cette refonte utilise les données
et actions existantes de GameNight. Le prototype séparé n'est pas la production.

## Livré

- Navigation latérale desktop, menu mobile accessible (focus/Échap via Radix),
  barre mobile conservée ; bibliothèque personnelle, groupe, tierlist,
  wishlist et vérification des jeux accessibles directement.
- Sélecteur de serveur permanent : même action vérifiée, blocage pendant la
  sauvegarde, messages de refus et retour à l'accueil conservés.
- Palette sombre violet/lime, ombres franches, cartes et onglets communs.
- Accueil avec raccourcis réels et progression XP du serveur actif ; toutes
  les sections existantes restent présentes (dettes, trophées, classement,
  actus, saisons, défis, onboarding, guide).
- Calendrier mois/semaine, sélection de date partageable, agenda du jour,
  soirées privées filtrées, roulettes planifiées créées/invitées uniquement.
  Aucun jeu proposé par une roulette n'est révélé. La timeline horaire,
  l'édition des disponibilités personnelles et les filtres par pote restent
  disponibles sous la grille. Aucun appel SQL par cellule de calendrier.
- Données du calendrier limitées au serveur sélectionné : roster ACTIVE,
  disponibilités limitées aux mêmes ids, sessions et roulettes via
  `getActiveScopedPrisma`. Le filtre de potes ne supprime plus les autres
  choix du panneau, ce qui permet de les réafficher.
- Profil avec bannière et avatar existants, progression XP circulaire, stats
  et onglets existants ; connexion Discord avec nouvelle présentation mais
  action OAuth, erreurs et contrôle du chemin de retour inchangés.
- Roulette explicitement « Instantanée » ou « Pour plus tard ». « Jouer
  maintenant » reste un parcours distinct.

Les avatars/bannières GIF, `BadgeGrid`, les trophées, rangs, streaks,
récompenses, célébrations et préférences sonores ne sont pas remplacés par
les fixtures du prototype. Les formulaires `CreationForm` et leurs clés
d'idempotence ne sont pas modifiés.

## Animations et coût

Fond aurora déplacé via `transform` plutôt qu'animation de fond du body,
sept météores sur desktop uniquement ; démontage des météores si l'onglet
est caché, si les animations sont mises en pause ou si le système demande
moins de mouvement. Le bouton du menu enregistre la préférence localement.
Les GIFs personnels ne sont pas affectés par ce bouton décoratif.

Les liens du menu et de la grille ont `prefetch={false}` : afficher 35/42
jours ne lance pas un chargement de page par jour. Le calendrier lit une
seule plage mensuelle, ajoute une lecture bornée des roulettes, et réutilise
les données pour la vue semaine et l'agenda. Aucun cache global de droits.

## Limite explicite

`Tournament` n'a pas de date de début planifiée. Les tournois restent
accessibles dans le menu et l'agenda par leur route réelle, sans les placer
sur une date inventée. Une éventuelle planification de tournois serait un
changement fonctionnel distinct. Aucun schéma ou migration dans cette PR.

## Sources et licences

Sources Magic UI incorporées dans `src/components/magicui` : Meteors,
Aurora Text, Shine Border, Magic Card, Animated Circular Progress Bar.
Registres officiels consultés le 08/10/2026 :

- https://magicui.design/r/meteors.json
- https://magicui.design/r/aurora-text.json
- https://magicui.design/r/shine-border.json
- https://magicui.design/r/magic-card.json
- https://magicui.design/r/animated-circular-progress-bar.json

Licence MIT complète : [MAGIC_UI_LICENSE.txt](licenses/MAGIC_UI_LICENSE.txt).
Adaptations : `framer-motion` déjà installé remplace `motion/react`, thème
sombre fixe sans `next-themes`, classes concaténées sans nouvelle dépendance,
styles de météores déterministes sans second rendu, préférence système
respectée pour le suivi du pointeur.

Les références 21st.dev ont guidé une adaptation originale :

- https://21st.dev/@sean0205/components/reui-event-calendar/variant-4
- https://21st.dev/@halaska-studio/components/calendar/controlled
- https://21st.dev/@iamsatish4564/components/animated-profile-card/blue-profile-card
- https://21st.dev/@felipemenezes098/components/sign-in-6

Bordures/ombres inspirées de https://neobrutalism.com/docs/components/card,
https://neobrutalism.com/docs/components/calendar et
https://neobrutalism.com/docs/components/avatar.
Aucune dépendance ni lockfile modifié.

## Contrôles manuels sur environnement autorisé

1. Desktop/mobile : parcourir le menu (groupe/tierlist/wishlist compris),
   ouvrir/fermer au clavier le menu mobile, vérifier l'état actif des liens.
2. Calendrier : mois précédent/suivant, semaine, aujourd'hui, choisir un jour,
   ouvrir une soirée, préparer une soirée avec date préremplie, modifier sa
   disponibilité, filtrer puis réafficher un pote.
3. Changer A/B : le nom du serveur, XP, événements et disponibilités doivent
   être ceux du serveur choisi. Un détail privé non invité reste inaccessible.
4. Profil : GIF de bannière/avatar, badges animés, stats, paramètres et sons.
5. Animations : mettre en pause, recharger, tester la préférence système de
   mouvement réduit. La décoration s'arrête, les contrôles restent utilisables.
6. Créer une soirée/roulette/tournoi : le verrou de double clic et les parcours
   Discord existants doivent rester identiques. Ces contrôles réels ne sont
   pas exécutés sur Discord/Neon par cette PR.

Validation automatique locale et CI détaillée dans la description de PR.
