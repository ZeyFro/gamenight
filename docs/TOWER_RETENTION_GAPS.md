# Fidélisation et recrutement — état vérifié

## Déjà disponible

- L’accueil personnalisé (`/bienvenue`) guide lier Steam, renseigner ses disponibilités, trouver les jeux du groupe, rejoindre les soirées, jouer immédiatement et suivre tournois/classement.
- `/potes` montre les membres accessibles, leurs jeux récents et, si activé, l’activité Steam « En jeu ». Le profil partageable expose bibliothèque, tierlist, badges, équipement et identifiants de jeu selon les choix existants.
- Le calendrier, les créneaux et les sondages de disponibilité aident à trouver un moment commun. Les soirées et tournois permettent des invitations ciblées; les notifications suivent les préférences existantes.
- `/joueurs` fournit une recherche de joueurs courte et éphémère : jeu + message, visible aux membres actifs, durée de 24 h, suppression auteur/admin, activation par communauté.
- La progression existante comprend XP, badges, défis hebdomadaires, saisons et classements. Les notifications in-app existent; Web Push et plusieurs annonces Discord sont configurables séparément et restent inactifs si leurs prérequis/drapeaux ne sont pas activés.
- Le service worker met uniquement en cache la page statique `/offline.html` et l’utilise comme repli des navigations échouées. Il ne met pas en cache les API ni les pages privées : ce n’est pas une expérience hors ligne complète.

## Lacunes démontrées

- Aucun parcours dédié de parrainage, d’ambassadeur ou d’invitation suivie n’a été trouvé dans l’application. Les invitations observées concernent des soirées/tournois. Éviter les récompenses liées au simple volume d’invitations.
- Les petites annonces LFG expirent rapidement et ne représentent ni projet durable, ni équipe, responsable, places et calendrier commun.
- L’onboarding est une visite guidée statique; il n’ajuste pas encore les suggestions à l’objectif déclaré du nouveau membre ou à ses jeux favoris.
- La présence « en jeu » ne couvre que l’activité Steam détectée; elle ne prouve pas qu’une personne est disponible ou souhaite être contactée.
- La PWA ne permet pas de consulter hors ligne le calendrier, les équipes ou le profil. Ce périmètre doit rester volontairement limité aux données publiques tant qu’un modèle de cache privé sûr n’est pas spécifié.

## Première étape recommandée

1. Ajouter un tableau de bord d’équipes/projets durables par communauté, réutilisant le catalogue de jeux, les communautés et les sessions existantes. L’inscription et la découverte doivent exiger une appartenance ACTIVE; pas de serveur Discord séparé requis.
2. Relier une équipe à des sessions GameNight existantes plutôt que créer un second calendrier. Conserver l’annonce LFG de 24 h pour les parties spontanées.
3. Améliorer l’accueil par des liens/contextes communautaires disponibles; ne pas ajouter d’import de contacts, suivi d’invitations, ni message automatique.
4. Garder les rappels facultatifs et les annonces externes désactivés par défaut. Avant toute notification, respecter le consentement existant et offrir un retrait; préférer le centre in-app. Aucun ping public ou récompense d’invitation brute.
5. Reporter l’ambassadeur et le parrainage jusqu’à une définition de signaux qualitatifs et d’une modération des abus. Ne pas attribuer d’XP pour l’inscription d’un filleul.
6. Garder le service worker actuel sans cache authentifié; tout enrichissement hors ligne demande un modèle explicite d’expiration, purge à la déconnexion et tests de fuite entre comptes.

## Vérifications avant activation

- Tests d’accès d’un membre actif, non-membre, membre retiré et membre d’une autre communauté.
- Tests d’actions répétées, limites de débit, inscriptions concurrentes à capacité pleine et autorisation du responsable.
- Tests qu’aucune notification Discord/Web Push n’est envoyée quand les options sont absentes/désactivées; tests d’opt-out lorsqu’elles sont activées.
- Tests PWA démontrant qu’aucune route privée ou réponse `/api` n’entre dans le cache.

Les recommandations sur l’activité et la disponibilité ne sont pas des constats de fréquentation : aucune mesure de messages, d’activité des salons Discord ou de conversions d’invitations n’est incluse dans l’audit Discord.
