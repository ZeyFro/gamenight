# Neon / Vercel — rotation du mot de passe neondb_owner avant ouverture publique

> Procédure uniquement. Ne rien exécuter sans fenêtre approuvée.

## Pourquoi

Le rôle Production actuel est `neondb_owner`. Avant l'ouverture publique, son mot de passe doit être renouvelé et le secret `DATABASE_URL` Production de Vercel doit être remplacé par une URL utilisant le nouveau mot de passe.

Le secret Vercel Production existe actuellement sous le nom `DATABASE_URL` et est distinct du `DATABASE_URL` de la branche Preview `preview-tower`.

## Préparation

1. choisir une fenêtre courte sans migration simultanée ;
2. vérifier qu'un retour arrière Vercel récent est disponible ;
3. créer et vérifier un snapshot Neon frais de la branche `production` ;
4. préparer la page Vercel **Settings → Environment Variables** et la fiche du rôle `neondb_owner` dans Neon ;
5. ne jamais copier le mot de passe dans Git, un ticket, Discord ou ChatGPT.

## Rotation

1. Dans Neon, réinitialiser le mot de passe du rôle `neondb_owner`.
2. Récupérer localement la nouvelle URL de connexion **poolée** destinée au runtime Vercel.
3. Dans le projet Vercel `gamenight`, modifier uniquement le secret `DATABASE_URL` ciblé **Production**. Ne pas toucher au secret Preview `preview-tower`.
4. Vérifier que la valeur est enregistrée comme secret/sensitive et que la cible reste `Production`.
5. Déclencher un nouveau déploiement Production afin que le runtime reçoive le nouveau secret.

## Contrôles après redéploiement

- déploiement Vercel `READY` ;
- page publique accessible ;
- authentification fonctionnelle ;
- une lecture applicative et une écriture non destructive fonctionnent ;
- aucun pic d'erreurs d'authentification PostgreSQL dans les logs runtime ;
- les anciens déploiements ne doivent pas être remis en trafic avec l'ancien secret.

Si le nouveau déploiement échoue à se connecter, corriger le secret Vercel avec la nouvelle URL générée par Neon ; **ne pas réinitialiser à nouveau le mot de passe à l'aveugle**.

## Après séparation des rôles

Quand un rôle runtime dédié aura remplacé `neondb_owner`, cette procédure s'appliquera au mot de passe du rôle runtime. `neondb_owner` ou le futur rôle migration ne devra plus être présent dans `DATABASE_URL` de l'application.
