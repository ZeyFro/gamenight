# Notifications sur le téléphone : les 3 clés VAPID

> Décision de Maxime (Q7, 23/11/2026) : oui. Ce guide sert à ChatGPT, qui pose les clés dans Vercel pour Maxime. Rien ici n'est un secret : les vraies clés n'apparaissent jamais dans le dépôt.

## Ce que sont ces clés

Le navigateur du joueur n'accepte une notification que si elle est signée. Le site signe avec une **clé privée** (secrète) ; le navigateur vérifie avec la **clé publique**. Le **sujet** est un contact (adresse `mailto:` ou page `https://`) que les services de notification utilisent en cas de problème.

| Variable Vercel | Contenu | Secret ? |
| --- | --- | --- |
| `WEB_PUSH_VAPID_SUBJECT` | `mailto:` suivi de l'adresse de contact, ou une adresse `https://` | Non |
| `WEB_PUSH_VAPID_PUBLIC_KEY` | Clé publique (87 caractères environ, lettres, chiffres, `-` et `_`) | Non |
| `WEB_PUSH_VAPID_PRIVATE_KEY` | Clé privée (43 caractères environ) | **Oui** : cocher **Sensitive** |
| `WEB_PUSH_ENABLED` | `true` | Non |

## Étapes

1. **Générer la paire de clés une seule fois**, sur un ordinateur où Node.js est installé (celui de Maxime de préférence) :
   ```
   npx web-push generate-vapid-keys
   ```
   La commande affiche « Public Key » et « Private Key ». Ne les écris dans aucun fichier, aucun message et aucune capture.
2. **Vercel → projet gamenight → Settings → Environment Variables**, environnement **Production** seulement :
   - `WEB_PUSH_VAPID_SUBJECT` = l'adresse de contact, sous la forme `mailto:…` ;
   - `WEB_PUSH_VAPID_PUBLIC_KEY` = la clé publique ;
   - `WEB_PUSH_VAPID_PRIVATE_KEY` = la clé privée, avec **Sensitive** coché ;
   - `WEB_PUSH_ENABLED` = `true`.
3. Vérifier que la migration `web_push_subscriptions` est appliquée (elle l'est en Production depuis le relevé du 22/11 : 151/151).
4. **Deployments → Redeploy** du dernier déploiement de Production.
5. **Vérifier** : sur un téléphone, ouvrir le site, accepter les notifications dans le profil, puis recevoir une notification de test.

## Ce que le site contrôle tout seul

`src/lib/web-push-config.ts` refuse la configuration si une variable manque, si le sujet n'est ni `mailto:` ni `https://`, ou si la clé publique ne correspond pas à la clé privée. Dans ce cas, aucune notification n'est envoyée et le journal du serveur cite **le nom** de la variable en cause, jamais sa valeur.

## Retour arrière

Supprimer `WEB_PUSH_ENABLED` (ou les 4 variables), puis Redeploy. **Ne jamais changer la paire de clés** sans raison : chaque appareil déjà abonné devrait se réabonner.
