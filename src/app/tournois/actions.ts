"use server";

import { resumeCreation } from "@/lib/creation-resume";

import { createOnce, creationKey, lockCreationMembers } from "@/lib/creation-intent";
import { lockCommunityProgress } from "@/lib/member-stats";
import { statsCommunityIdForSession } from "@/lib/community-stats";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getScopedPrisma, scopedTransactionPrisma } from "@/lib/community-scoped-client";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/current-user";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  generateBracket,
  declareWinner,
  buildBracketInTransaction,
  cancelTournament,
  deleteTournament,
} from "@/lib/tournaments";
import {
  enqueueTournamentCreationDeliveries,
  enqueueTournamentThreadMember,
  resyncTournamentThreadMembers,
} from "@/lib/tournament-announce";
import { postToDiscord, ACCENT_COLOR } from "@/lib/discord";
import { requireCommunityBotAnnouncement } from "@/lib/community-announcement-required";
import { resolveAbsoluteUrl } from "@/lib/app-url";
import { pickCreationCommunityId, resolveTournamentAnnounceConfig } from "@/lib/community-channels";
import { canAccessTournament } from "@/lib/community-access";
import { communityMemberUserWhere, isCommunityIsolationEnabled } from "@/lib/community-isolation";
import { parseNotifyRecipientsFromFormData } from "@/lib/notify-recipients";
import { logger } from "@/lib/logger";
import {
  createTournamentSchema,
  declareWinnerSchema,
  idSchema,
  VALIDATION_ERROR_KEY,
} from "@/lib/validations";

/**
 * Sprint 5 (FEATURE 1, Tournois Bracket) — création : le créateur choisit
 * un jeu de la biblio commune (pas de restriction à sa biblio perso,
 * même logique que `createSession`/proposer un jeu — un tournoi concerne
 * tout le groupe) et le nombre de places (4/6/8, cf. `bracketSizeFor`).
 * Annonce Discord immédiate ("inscriptions ouvertes").
 *
 * Fix bug remonté (annonce tournoi sans lien) — le message ne contenait
 * jusqu'ici aucun moyen d'atteindre `/tournois/{id}`, obligeant à
 * chercher la page à la main. `resolveAbsoluteUrl` (src/lib/app-url.ts)
 * dérive l'URL absolue depuis les variables que Vercel injecte
 * automatiquement (Production ET Preview, sans domaine codé en dur, sans
 * configuration côté projet). Si elle ne peut pas être résolue (dev
 * local, ou variables Vercel absentes — cas qui ne devrait jamais
 * arriver en déploiement réel), le lien est explicitement omis du
 * message (texte d'origine conservé, warning loggué) — jamais de lien
 * cassé (`.../undefined`) envoyé dans Discord.
 */
export async function createTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  const resumed = await resumeCreation(user.id, "TOURNAMENT", formData);
  if (resumed) redirect(resumed);
  if (!checkRateLimit(user.id, "createTournament")) {
    redirect(`/tournois/creer?error=${VALIDATION_ERROR_KEY}`);
  }

  const input = createTournamentSchema.safeParse({
    name: String(formData.get("name") ?? ""),
    gameId: String(formData.get("gameId") ?? ""),
    maxPlayers: String(formData.get("maxPlayers") ?? ""),
  });
  if (!input.success) {
    redirect(`/tournois/creer?error=${VALIDATION_ERROR_KEY}`);
  }
  const { name, gameId, maxPlayers } = input.data;

  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { name: true } });
  if (!game) redirect(`/tournois/creer?error=${VALIDATION_ERROR_KEY}`);

  // V2 (notifications maîtrisées) — sélection du créateur pour la mention
  // Discord à l'ouverture des inscriptions, JAMAIS une liste d'accès ni
  // des participants automatiquement inscrits (même garde que
  // `createSession`, session-lifecycle.ts : ne garde que des ids qui
  // correspondent réellement à un user existant, filtre silencieusement le
  // reste plutôt que de faire échouer toute la création). Persistée que le
  // tournoi soit `announceViaBot` ou non (cohérent avec `Session.notifiedUserIds`) —
  // seul le chemin bot la lit réellement (le webhook existant, sans
  // notion de mention Discord, ne la consulte jamais).
  // Multi-communautés (PR4) : communauté du tournoi résolue AVANT les
  // destinataires. Sous isolation, sans aucune communauté on refuse (le
  // tournoi serait sinon rattaché à `default` sans que le créateur en soit
  // membre) ; sinon seuls des membres de CETTE communauté sont mentionnables.
  const communityId = await pickCreationCommunityId(user.id);
  if (isCommunityIsolationEnabled() && communityId === null) {
    redirect(`/tournois/creer?error=${VALIDATION_ERROR_KEY}`);
  }
  const notifyUserIds = parseNotifyRecipientsFromFormData(formData);
  const notifiedUserIds = notifyUserIds.length
    ? (
        await prisma.user.findMany({
          where: { AND: [{ id: { in: notifyUserIds } }, await communityMemberUserWhere(communityId)] },
          select: { id: true },
        })
      ).map((u) => u.id)
    : [];

  // Chantier annonces tournois (étend #99) — figé UNE SEULE FOIS ici,
  // jamais relu depuis l'env ensuite (voir le commentaire du champ dans
  // schema.prisma). Revue ciblée avant merge #100 : la DESTINATION
  // (guildId/channelId) est figée EN MÊME TEMPS que `announceViaBot`, pas
  // seulement le booléen — une seule lecture de `getTournamentAnnounceConfig()`
  // ici, jamais deux lectures séparées qui pourraient voir des valeurs
  // différentes si la config change entre les deux. Le résolveur
  // (`tournamentAnnounceResolver`) n'utilisera plus jamais l'env pour la
  // destination d'un tournoi bot après ce point — voir son commentaire de
  // fichier. Création du tournoi ET enqueue de l'intention de notification
  // bot dans LA MÊME transaction SQL (même raisonnement que `createSession`,
  // session-lifecycle.ts, revue ciblée #99) : un crash entre les deux
  // laisserait sinon un tournoi `announceViaBot=true` orphelin, jamais
  // annoncé, sans échec observable nulle part. Aucun appel Discord dans
  // cette transaction (seulement des écritures, ni la lecture de config
  // ci-dessus — une variable d'env — ni la vérification réseau du salon,
  // qui n'a lieu que plus tard, au premier SEND réel, voir
  // `tournament-announce.ts`).
  // Multi-communautés (PR3) : destination de la communauté du tournoi ; sans
  // `COMMUNITY_CHANNELS_ENABLED`, `communityId` est `null` et la configuration
  // est celle de l'environnement, comme avant.
  const tournamentAnnounceConfig = await resolveTournamentAnnounceConfig(communityId);
  const announceViaBot =
    process.env.DISCORD_BOT_TOURNAMENT_ANNOUNCE_ENABLED === "true" && tournamentAnnounceConfig !== null;
  await requireCommunityBotAnnouncement(communityId, announceViaBot);

  const { result: tournament, replayed } = await createOnce(user.id, "TOURNAMENT", creationKey(formData.get("creationKey"), true), async (tx) => {
    await lockCreationMembers(tx, communityId, [user.id, ...notifiedUserIds]);
    const created = await tx.tournament.create({
      data: {
        name,
        gameId,
        maxPlayers,
        createdById: user.id,
        announceViaBot,
        communityId,
        discordGuildId: announceViaBot ? tournamentAnnounceConfig!.guildId : null,
        discordChannelId: announceViaBot ? tournamentAnnounceConfig!.channelId : null,
        notifiedUserIds,
      },
    });
    if (announceViaBot) {
      await enqueueTournamentCreationDeliveries(created.id, tx);
      // Chantier auto-adhésion aux fils de tournois (V2) — constat remonté
      // (l'annonce et les pings arrivent, mais il fallait ouvrir le salon
      // PUIS rejoindre manuellement le fil) : le créateur ET chaque
      // destinataire sélectionné (`notifiedUserIds`, déjà validés contre
      // de vrais users ci-dessus) sont ajoutés au fil DANS CETTE MÊME
      // TRANSACTION — un crash entre les deux ne doit jamais laisser un
      // tournoi bot orphelin de la moindre intention d'adhésion. Ajouter
      // au fil n'inscrit JAMAIS au tournoi (aucune écriture
      // `TournamentParticipant` ici) — voir `enqueueTournamentThreadMember`.
      await enqueueTournamentThreadMember(created.id, user.id, tx);
      for (const notifiedId of notifiedUserIds) {
        await enqueueTournamentThreadMember(created.id, notifiedId, tx);
      }
    }
    return created;
  }, (created) => created.id, (tx, id) => tx.tournament.findUniqueOrThrow({ where: { id } }));

  // Webhook existant — UNIQUEMENT pour un tournoi resté sur ce chemin
  // (`announceViaBot=false`) : un tournoi bot a déjà enqueue son SEND ci-
  // dessus, jamais les deux transports à la fois (voir le commentaire de
  // fichier de `tournament-announce.ts`).
  if (!announceViaBot && !replayed) {
    const tournamentUrl = resolveAbsoluteUrl(`/tournois/${tournament.id}`, {
      VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_URL: process.env.VERCEL_URL,
      VERCEL_PROJECT_PRODUCTION_URL: process.env.VERCEL_PROJECT_PRODUCTION_URL,
    });
    if (!tournamentUrl) {
      logger.warn(
        "tournaments",
        "URL absolue indisponible (dev local ou variables Vercel absentes) — lien omis de l'annonce Discord.",
        { tournamentId: tournament.id }
      );
    }

    const result = await postToDiscord({
      title: `🏆 Tournoi ${name} sur ${game.name} — inscriptions ouvertes !`,
      description: tournamentUrl
        ? `${maxPlayers} places disponibles. Inscris-toi ici : ${tournamentUrl}`
        : `${maxPlayers} places disponibles. Inscris-toi sur l'app !`,
      color: ACCENT_COLOR,
    });
    if (!result.ok) {
      logger.warn("tournaments", "Notif Discord création tournoi non envoyée.", {
        tournamentId: tournament.id,
      });
    }
  }

  revalidatePath("/tournois");
  redirect(`/tournois/${tournament.id}`);
}

/**
 * Inscription à un tournoi encore en `REGISTRATION`, tant que les places
 * ne sont pas toutes prises.
 *
 * Fix bug remonté (concurrence tournois, round 2) — l'ancien code lisait
 * `status`/le nombre de places/la présence de l'utilisateur AVANT de
 * créer la ligne `TournamentParticipant`, sans le moindre verrou : deux
 * inscriptions concurrentes sur la toute dernière place passaient
 * toutes les deux ce contrôle (lu avant que l'autre n'ait committé),
 * dépassant `maxPlayers` — le participant en trop restait inscrit en
 * base mais silencieusement absent du bracket construit par
 * `generateBracket` (qui ne prend que les `bracketSize` premiers tirés).
 * Toute la vérification + l'écriture (et, le cas échéant, la
 * construction du bracket si cette inscription remplit la dernière
 * place) tournent maintenant dans UNE transaction qui verrouille D'ABORD
 * la ligne `Tournament` (`SELECT ... FOR UPDATE`, même verrou que
 * `unregisterFromTournamentAction`/`buildBracketInTransaction`, voir ces
 * deux fonctions) — Postgres sérialise toute désinscription ou tentative
 * de lancement concurrente sur ce même tournoi, aucune ne peut plus
 * s'intercaler entre la lecture et l'écriture.
 *
 * Quand cette inscription remplit la dernière place, le bracket est
 * construit via `buildBracketInTransaction(tx, ...)` — PAS via le
 * wrapper public `generateBracket`, qui ouvrirait une seconde
 * transaction : celle-ci réutilise le verrou déjà tenu par CETTE
 * transaction (réentrant, jamais un deadlock avec soi-même).
 */
export async function registerForTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "registerForTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  // Multi-communautés (PR4) : on ne s'inscrit pas à un tournoi d'une autre
  // communauté, même en connaissant son id (aucune lecture si isolation éteinte).
  if (!(await canAccessTournament(user.id, tournamentId))) return;

  const registered = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      { id: string; status: string; maxPlayers: number; announceViaBot: boolean; communityId: string | null }[]
    >`
      SELECT id, status, "maxPlayers", "announceViaBot", "communityId" FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE
    `;
    const tournament = locked[0];
    if (!tournament || tournament.status !== "REGISTRATION") return false;
    const communityId = await statsCommunityIdForSession(tournament.communityId);
    if (!(await lockCommunityProgress(tx, communityId, user.id))) return false;
    const scopedDb = scopedTransactionPrisma(tx, isCommunityIsolationEnabled() ? { communityIds: [communityId], includesDefault: false } : null);

    const participants = await tx.tournamentParticipant.findMany({
      where: { tournamentId },
      select: { userId: true },
    });
    if (participants.length >= tournament.maxPlayers) return false;
    if (participants.some((p) => p.userId === user.id)) return false;

    try {
      await tx.tournamentParticipant.create({ data: { tournamentId, userId: user.id } });
    } catch {
      // Contrainte unique (déjà inscrit) — ne devrait plus se produire
      // sous ce verrou (le re-check ci-dessus le prévient déjà pour
      // toute transaction concurrente sur ce tournoi), gardé en filet de
      // sécurité minimal, comportement identique à avant.
      return false;
    }

    // Chantier auto-adhésion aux fils de tournois (V2) — un joueur qui
    // s'inscrit rejoint automatiquement le fil, DANS CETTE MÊME
    // TRANSACTION que son inscription (même raisonnement que ci-dessus) —
    // jamais l'inverse (rejoindre le fil n'inscrit jamais au tournoi,
    // cette fonction n'écrit d'ailleurs aucun `TournamentParticipant`).
    if (tournament.announceViaBot) {
      await enqueueTournamentThreadMember(tournamentId, user.id, tx);
    }

    // Chantier nettoyage réel du stockage (V2, suite) — résumé durable
    // MINIMAL (`CommunityMemberStats.tournamentsParticipatedCount`) maintenu
    // ICI, à l'inscription, DANS CETTE MÊME TRANSACTION : ce compteur
    // remplace un `tournamentParticipant.count({userId})` qui deviendrait
    // faux dès qu'un tournoi ancien est purgé (voir badges.ts,
    // `checkTournamentBadges`) — jamais recalculé par un `count()` sur des
    // lignes vouées à disparaître.
    await scopedDb.communityMemberStats.createMany({ data: [{ communityId, userId: user.id }], skipDuplicates: true });
      await scopedDb.communityMemberStats.update({
        where: { communityId_userId: { communityId, userId: user.id } },
        data: { tournamentsParticipatedCount: { increment: 1 } },
      });

    // Places pleines → lancement automatique du bracket (spec), dans
    // CETTE transaction (voir docstring ci-dessus).
    if (participants.length + 1 >= tournament.maxPlayers) {
      await buildBracketInTransaction(tx, tournamentId);
    }

    return true;
  });

  if (!registered) return;

  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
}

/**
 * Désinscription, réservée à soi-même, tant que le tournoi n'a pas
 * encore démarré.
 *
 * Fix bug remonté (concurrence tournois, round 2) — l'ancien code lisait
 * `status` puis supprimait la ligne sans le moindre verrou : une
 * désinscription pouvait s'intercaler entre la lecture des participants
 * et l'écriture d'un lancement de bracket en cours
 * (`generateBracket`/`registerForTournamentAction`), qui tentait ensuite
 * de mettre à jour une ligne `TournamentParticipant` déjà supprimée —
 * exception non catchée, transaction entière annulée (y compris le
 * `status` déjà basculé). Verrouille maintenant D'ABORD la même ligne
 * `Tournament` (`SELECT ... FOR UPDATE`) que `registerForTournamentAction`/
 * `buildBracketInTransaction` avant de relire `status` et de supprimer —
 * Postgres sérialise, aucune fenêtre ne subsiste.
 */
export async function unregisterFromTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "unregisterFromTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  if (!(await canAccessTournament(user.id, tournamentId))) return;
  const unregistered = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string; status: string; communityId: string | null }[]>`
      SELECT id, status, "communityId" FROM "Tournament" WHERE id = ${tournamentId} FOR UPDATE
    `;
    const tournament = locked[0];
    if (!tournament || tournament.status !== "REGISTRATION") return false;
    const communityId = await statsCommunityIdForSession(tournament.communityId);
    if (!(await lockCommunityProgress(tx, communityId, user.id))) return false;
    const scopedDb = scopedTransactionPrisma(tx, isCommunityIsolationEnabled() ? { communityIds: [communityId], includesDefault: false } : null);

    const deleted = await tx.tournamentParticipant.deleteMany({ where: { tournamentId, userId: user.id } });
    // Décrémente le compteur durable SEULEMENT si une inscription a
    // réellement été retirée (jamais sur un double appel/une inscription
    // déjà absente) — voir le commentaire de `registerForTournamentAction`.
    if (deleted.count > 0) {
      // Les inscriptions historiques hors default n'ont pas de compteur attribuable.
      await scopedDb.communityMemberStats.updateMany({
        where: { communityId, userId: user.id, tournamentsParticipatedCount: { gt: 0 } },
        data: { tournamentsParticipatedCount: { decrement: 1 } },
      });
    }
    return true;
  });

  if (!unregistered) return;

  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
}

/** Lancement anticipé par le créateur, avant que les places soient toutes prises. */
export async function launchTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "launchTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  const scopedDb = await getScopedPrisma(user.id);
  const tournament = await scopedDb.tournament.findUnique({
    where: { id: tournamentId },
    select: { createdById: true, status: true },
  });
  if (!tournament || tournament.createdById !== user.id || tournament.status !== "REGISTRATION") {
    return;
  }

  await generateBracket(tournamentId);
  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
}

/**
 * Déclare le vainqueur d'un match — réservé au créateur du tournoi ou à
 * l'un des deux joueurs (cf. `declareWinner`, src/lib/tournaments.ts, pour
 * le contrôle de permission). Vérifie les badges de TOUS les
 * participants si le tournoi vient de se terminer (le champion et les
 * demi-finalistes gagnent potentiellement "Champion de tournoi"/
 * "Gladiateur" en même temps que l'XP).
 */
export async function declareWinnerAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "declareWinner")) return;

  const input = declareWinnerSchema.safeParse({
    matchId: String(formData.get("matchId") ?? ""),
    winnerId: String(formData.get("winnerId") ?? ""),
  });
  if (!input.success) return;

  const result = await declareWinner(input.data.matchId, input.data.winnerId, user.id);
  if (!result.ok) return;


  const match = await prisma.tournamentMatch.findUnique({
    where: { id: input.data.matchId },
    select: { tournamentId: true },
  });
  if (match) {
    revalidatePath(`/tournois/${match.tournamentId}`);
    revalidatePath("/tournois");
    revalidatePath("/");
  }
}

/**
 * Annulation (V2) — réservée au créateur, un tournoi DÉMARRÉ uniquement
 * (voir `cancelTournament`, src/lib/tournaments.ts, pour le contrôle
 * d'autorisation serveur ET la protection contre la course avec la
 * clôture du dernier match). Préserve intégralement matchs/résultats déjà
 * enregistrés — jamais une suppression.
 */
export async function cancelTournamentAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "cancelTournament")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  const result = await cancelTournament(tournamentId, user.id);
  if (!result.ok) return;

  revalidatePath(`/tournois/${tournamentId}`);
  revalidatePath("/tournois");
  revalidatePath("/");
}

/**
 * Bug remonté en test réel — aucune redirection après suppression, page
 * incohérente, F5 nécessaire. `redirect()` (jamais entouré d'un
 * try/catch ici, ni côté `DeleteTournamentDialog`) fonctionnait déjà
 * correctement pour un SEUL clic : le vrai coupable était côté client —
 * aucune protection contre un double clic sur "Oui, supprimer" (aucun
 * état pending, bouton jamais désactivé). Un second clic pendant que le
 * premier est encore en vol relance cette même action ; le second appel
 * trouve alors le tournoi déjà supprimé (`deleteTournament` retourne
 * `{ ok: false }`, la ligne "course perdue" de sa transaction — voir
 * son commentaire dans tournaments.ts) et se termine SANS `redirect()`.
 * Deux résolutions concurrentes d'une même transition React (l'une avec
 * navigation, l'autre sans) pouvaient laisser le client dans un état
 * incohérent. Corrigé À LA SOURCE côté `DeleteTournamentDialog`
 * (`useActionState`, bouton désactivé tant que `pending`) — cette action
 * expose maintenant aussi un état d'erreur lisible (ex. tournoi déjà
 * lancé entre l'ouverture du dialogue et la confirmation) au lieu de ne
 * rien faire silencieusement.
 */
export type DeleteTournamentActionState = { error: string | null };

const DELETE_TOURNAMENT_ERROR_MESSAGES: Record<string, string> = {
  not_found: "Ce tournoi n'existe plus.",
  not_creator: "Seul le créateur du tournoi peut le supprimer.",
  not_registration:
    "Ce tournoi a déjà démarré (ou a été supprimé) entre l'ouverture de cette fenêtre et ta confirmation — impossible de le supprimer maintenant.",
};

/**
 * Suppression (V2) — réservée au créateur, un tournoi NON démarré
 * uniquement (voir `deleteTournament`, src/lib/tournaments.ts, pour le
 * contrôle d'autorisation serveur, la protection contre la course avec un
 * lancement concurrent, et le traitement Discord de l'annonce déjà
 * postée le cas échéant). Confirmation explicite gérée côté UI
 * (`DeleteTournamentDialog`) avant que ce formulaire ne soit soumis.
 *
 * Signature `(prevState, formData)` — compatible `useActionState`
 * (`DeleteTournamentDialog`), qui en tire à la fois l'état pending (pour
 * désactiver le bouton pendant l'appel, voir le commentaire ci-dessus) et
 * un message d'erreur affichable sans jamais avoir à parser une
 * redirection manquante côté client.
 */
export async function deleteTournamentAction(
  _prevState: DeleteTournamentActionState,
  formData: FormData
): Promise<DeleteTournamentActionState> {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "deleteTournament")) return { error: null };

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return { error: null };
  const tournamentId = input.data;

  const result = await deleteTournament(tournamentId, user.id);
  if (!result.ok) {
    return { error: DELETE_TOURNAMENT_ERROR_MESSAGES[result.reason ?? ""] ?? "Suppression impossible pour le moment." };
  }

  revalidatePath("/tournois");
  redirect("/tournois");
}

/**
 * Resynchronisation GROUPÉE du fil du tournoi — réservée au créateur (V2,
 * chantier auto-adhésion), pour un tournoi créé AVANT ce correctif : ni le
 * créateur ni les destinataires sélectionnés/inscrits n'ont alors la
 * moindre livraison d'adhésion enqueue-ée. Ne recrée JAMAIS le fil, ne
 * renvoie AUCUNE annonce, ne reping personne (voir
 * `resyncTournamentThreadMembers`, tournament-announce.ts) — jamais
 * exécutée contre la production par cette PR (livrée comme outil, pas
 * comme rattrapage automatique).
 */
export async function resyncTournamentThreadMembersAction(formData: FormData) {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  if (!checkRateLimit(user.id, "resyncTournamentThreadMembers")) return;

  const input = idSchema.safeParse(String(formData.get("tournamentId") ?? ""));
  if (!input.success) return;
  const tournamentId = input.data;

  const scopedDb = await getScopedPrisma(user.id);
  const tournament = await scopedDb.tournament.findUnique({
    where: { id: tournamentId },
    select: { createdById: true, announceViaBot: true },
  });
  if (!tournament || tournament.createdById !== user.id || !tournament.announceViaBot) return;

  await resyncTournamentThreadMembers(tournamentId);

  revalidatePath(`/tournois/${tournamentId}`);
}
