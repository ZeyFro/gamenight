# Clips MP4 privés

`SESSION_VIDEO_ENABLED` doit valoir exactement `true`; OFF par défaut. Le token Blob privé et l’activation communautaire de la galerie restent nécessaires. Aucun nouveau stockage, schéma ou fournisseur.

Les clips partagent avec les images la limite de 4 Mo par fichier, 8 médias par soirée, le consentement et les accès existants du créateur et des invités actifs. Le serveur vérifie la signature MP4 et une marque de conteneur connue; il ne garantit ni codec ni durée. Le navigateur fournit les contrôles de lecture et un lien de téléchargement.

La route privée vérifie les droits avant de lire le Blob et refuse les vidéos lorsque le flag est OFF. Elle prend en charge une plage d’octets simple (206), les suffixes et les plages invalides (416). La réponse reste privée et sans cache. Les lectures partielles vérifient la taille réelle, limitée à 4 Mo; seule la plage demandée est conservée en mémoire.

Validation locale du 19 octobre 2026 : 16 tests route/helper/action/UI réussis (26 avec la garde API après intégration calendrier/annulation), TypeScript, lint ciblé, diff check et build Next direct réussis, y compris après intégration des trois lots. Aucun upload Blob réel, aucune écriture PostgreSQL, aucun Discord réel et aucun flag distant activé. Lecture authentifiée sur navigateur et compatibilité des codecs sur appareils restent non vérifiées.
