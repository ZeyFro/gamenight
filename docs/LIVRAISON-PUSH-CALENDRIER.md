# Livraison : push navigateur et calendrier iCal

Aucun essai réel (appareil, service push, application calendrier) n'a été réalisé pour ce document. Tout ce qui suit sous « Prouvé en local » vient de tests exécutés avec un double du service push et une base Postgres jetable.

## Variables et drapeaux (noms seulement)

| Fonction | Variables | Éteinte par défaut |
|---|---|---|
| Push navigateur | `WEB_PUSH_ENABLED` (valeur exacte `true`), `WEB_PUSH_VAPID_SUBJECT`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` | oui |
| Abonnement iCal | `CALENDAR_SUBSCRIPTIONS_ENABLED` (valeur exacte `true`) ; migration `20261019140000_calendar_feed_tokens` | oui |
| Export `.ics` ponctuel | aucun drapeau (utilisateur connecté) | non, actif |

Migration du push : `20261017120000_web_push_subscriptions`. Aucune autre variable, aucun cron.

Sujet VAPID : `mailto:adresse@domaine` ou une URL `https://`.

## Générer et installer les clés VAPID sans les exposer

À lancer en local. La commande écrit la paire dans un fichier privé hors dépôt et n'affiche que son chemin :

```
node -e "const c=require('crypto'),e=c.createECDH('prime256v1');e.generateKeys();require('fs').writeFileSync(process.argv[1],'WEB_PUSH_VAPID_PUBLIC_KEY='+e.getPublicKey().toString('base64url')+'\nWEB_PUSH_VAPID_PRIVATE_KEY='+e.getPrivateKey().toString('base64url')+'\n',{mode:0o600});console.log('ecrit :',process.argv[1])" "$HOME/.gamenight-vapid.env"
```

Saisir ensuite les deux valeurs dans le champ de variable d'environnement (type secret) du tableau de bord de l'hébergeur, en les copiant depuis ce fichier, sans les coller dans une conversation, un ticket ou un commit. Ne jamais les mettre dans `.env.example`. Conserver la paire : la remplacer invalide tous les abonnements existants (les appareils doivent se réabonner).

À chaque envoi ou abonnement, l'application vérifie : sujet `mailto:`/`https://`, clé publique de 65 octets, clé privée de 32 octets, et que les deux forment bien une paire.

## Comportement en cas de mauvaise configuration

- `WEB_PUSH_ENABLED` différent de `true` : rien n'est envoyé, aucun bruit dans les journaux, l'écran Profil > Paramètres dit « désactivées par l'administrateur ».
- Allumé mais variable absente ou clé invalide/dépareillée : aucun envoi, aucune exception ; journal `web-push` (niveau warn) avec les NOMS des variables fautives (jamais les valeurs) ; l'abonnement répond `503 {error:"not_configured", reason}` ; l'écran dit que la configuration est incomplète ou invalide et de prévenir un administrateur.

## Prouvé en local (tests exécutés)

| Point | Test |
|---|---|
| Éteint par défaut, valeur exacte `true` (`false`, `TRUE`, `1`, vide : éteint) | `src/lib/web-push-config.test.ts` |
| Variables absentes nommées, clés invalides ou dépareillées refusées, valeur jamais citée | `src/lib/web-push-config.test.ts`, `src/lib/web-push-delivery.test.ts` |
| Envoi : 404/410 supprime l'appareil, 429/500/503/erreur réseau conserve, un échec n'arrête pas les autres appareils | `src/lib/web-push-delivery.test.ts` |
| Abonnement : création 201, doublon d'endpoint 200 sans double ligne, suppression, 401 sans session, endpoint hors fournisseurs connus 400, clés mal formées 400 | `src/app/api/push/subscription/route.integration.test.ts` (Postgres) |
| Isolation : endpoint d'un autre utilisateur refusé 409, suppression par un autre sans effet, limite de 5 appareils par compte, envoi limité aux appareils du destinataire | idem |
| Configuration invalide : 503 explicite, rien d'écrit, aucune clé dans la réponse | idem |
| Push déclenché après écriture in-app et sans bloquer l'action en cas d'échec | `src/lib/notifications.web-push.test.ts` |
| Jeton iCal : 256 bits aléatoires, seul le hash SHA-256 est en base, la rotation invalide l'ancien lien immédiatement, révocation par communauté, régénération | `src/lib/calendar-feed.integration.test.ts` |
| Visibilité : mêmes soirées que l'application (communauté du jeton, soirées sans communauté pour `default`, invitations actives, pas les privées des autres), réévaluée à chaque lecture (membre retiré ou communauté suspendue : 404) | idem |
| Le flux ne contient ni le jeton ni son hash ; lien inconnu, révoqué ou inaccessible : même 404 vide | `calendar-feed.integration.test.ts`, `src/app/api/calendrier/feed/[token]/route.test.ts` |
| En-têtes : `Cache-Control: private, no-store`, `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, `text/calendar; charset=utf-8` ; export en pièce jointe | `feed/[token]/route.test.ts`, `src/app/api/calendrier/export/route.test.ts` |
| Format : VTIMEZONE Europe/Paris, heures murales hiver/été, UID stables (`<id>@gamenight`), échappements `, ; \ \n`, lignes pliées à 75 octets UTF-8, fins CRLF | `src/lib/ical-calendar.test.ts` |
| Drapeau éteint : aucune émission ni lecture de jeton | `src/lib/calendar-feed.test.ts` |

## À faire par l'opérateur (non réalisé)

Prérequis : migrations appliquées, variables posées côté hébergeur, drapeau mis à `true` sur un environnement hors Production d'abord.

### Abonnement iCal

Sur `/calendrier`, créer le lien d'abonnement (affiché une seule fois), puis :

1. Google Agenda (web) : Autres agendas > À partir de l'URL, coller l'URL complète. Attendu : les soirées à venir (votes ou confirmées) du serveur actif, à l'heure de Paris. Google actualise lentement (plusieurs heures) : ce n'est pas un défaut.
2. Apple Calendrier (Mac ou iPhone) : Fichier > Nouvel abonnement à un calendrier, ou Réglages > Calendrier > Comptes > Ajouter un calendrier avec abonnement. Attendu : idem.
3. Un client mobile (Android, Outlook, Thunderbird) : ajout par URL. Attendu : idem.

Vérifier aussi : une soirée proche d'un changement d'heure, les accents du titre, un compte non membre ne voit rien.

Révoquer : bouton de révocation sur `/calendrier` (ou régénération, qui coupe l'ancien lien). Attendu : l'ancien lien répond 404 immédiatement. Les applications calendrier peuvent garder les événements déjà téléchargés : les supprimer côté application.

### Push

Sur Profil > Paramètres > Notifications push, « Activer sur cet appareil », accepter l'autorisation, puis déclencher une notification applicative réelle (par exemple un badge) avec un compte de test.

1. Chrome Android : attendu, notification système ; un toucher ouvre l'URL relative de l'application.
2. Safari iOS : exige un iOS récent, l'application ajoutée à l'écran d'accueil (PWA) et ouverte depuis cette icône, l'autorisation demandée par un geste dans l'application.
3. Navigateur de bureau (Chrome, Firefox, Edge) : attendu, notification du système.

Désactiver : « Désactiver sur cet appareil » (supprime l'abonnement en base et dans le navigateur), ou retirer l'autorisation dans les réglages du site. Tout couper : remettre `WEB_PUSH_ENABLED` à une valeur autre que `true`. Un appareil désinstallé est supprimé automatiquement au prochain envoi (réponse 404/410 du service).

## Prouvé en local ou nécessitant un appareil ou un service réel

| Prouvé en local | Nécessite un appareil ou un service réel |
|---|---|
| Logique d'abonnement, isolation, limite d'appareils, nettoyage 404/410, conservation sur 429/5xx | Remise réelle d'une notification par FCM, Mozilla, Apple |
| Validation des clés VAPID et messages d'erreur | Que la paire installée côté hébergeur soit celle attendue (non vérifié ici) |
| Contenu, UID, fuseau, échappements, pliage du `.ics` | Interprétation par Google Agenda, Apple Calendrier, clients mobiles ; fréquence de rafraîchissement |
| Révocation immédiate côté serveur, isolation par communauté | Cache d'un client calendrier qui garde d'anciens événements |
| Présence du service worker (`public/service-worker.js`) et de son gestionnaire `push` | Réception sur Safari iOS en PWA, autorisations propres à chaque navigateur |
