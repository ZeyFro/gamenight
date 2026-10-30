import { z } from "zod";
import type { InteractionOutput } from "@/lib/discord-interactions";
import type { DiscordActionRow } from "@/lib/discord-rest";
import { editSetupResponse, getTowerProofMessage } from "@/lib/discord-rest";
import { logger } from "@/lib/logger";
import { claimSoloTowerChallenge, getTowerChallengeState, resolveTowerDiscordActor,
  settleTowerChallenge, submitTowerChallengeProof, voteTowerChallenge, getTowerSeasonLeaderboard,
  getTowerSeasonVote, castTowerSeasonVote, getTeamDailyTowerChallenge, listDiscordTowerTeams,
  joinTowerTeamChallenge } from "@/lib/tower-challenges";

const snowflake = z.string().regex(/^[0-9]{16,20}$/);
const commonSchema = z.object({
  id: snowflake, application_id: snowflake, token: z.string().min(1).max(2048),
  guild_id: snowflake, channel_id: snowflake,
  member: z.object({ user: z.object({ id: snowflake, username: z.string().min(1).max(100), bot: z.literal(false).optional() }) }),
});
const componentDataSchema = z.object({
  custom_id: z.string().max(100), component_type: z.number().optional(),
  components: z.array(z.object({ type: z.literal(1), components: z.array(z.object({
    type: z.literal(4), custom_id: z.string(), value: z.string().max(1500),
  })).length(1) })).length(3).optional(),
});
const inputSchema = z.union([
  commonSchema.extend({
    type: z.union([z.literal(3), z.literal(5)]),
    message: z.object({ id: snowflake, author: z.object({ id: snowflake, bot: z.literal(true) }) }),
    data: componentDataSchema,
  }),
  commonSchema.extend({
    type: z.literal(2),
    data: z.object({ name: z.literal("tower"), options: z.array(z.object({ type: z.literal(1), name: z.enum(["defi", "progression", "classement", "vote", "equipe"]) })).length(1) }),
  }),
]);
const quiet = (content: string): InteractionOutput => ({ status: 200, body: { type: 4, data: { content, flags: 64, allowed_mentions: { parse: [] } } } });
const button = (label: string, custom_id: string, style: 1 | 2 | 3 = 2) => ({ type: 2 as const, style, label, custom_id });

export function towerChallengePanel(): { content: string; components: DiscordActionRow[]; allowedMentions: { parse: [] } } {
  return {
    content: "🏰 **The Tower — les défis**\nDéfi solo toutes les 12 h · 48 h pour déposer ta preuve · deux réussites récompensées par jour, solo et équipe confondus (heure de Paris). Une réussite d'équipe crédite les étages personnels des participants confirmés, sans score d'équipe supplémentaire.",
    components: [{ type: 1, components: [button("Mon défi", "gn:tower:claim", 1), button("Défi d’équipe", "gn:tower:teams"), button("Ma progression", "gn:tower:mine"), button("Classement", "gn:tower:leaderboard"), button("Vote saison", "gn:tower:season-vote")] }],
    allowedMentions: { parse: [] },
  };
}
function proofModal(attemptId: string) {
  const field = (custom_id: string, label: string, max_length: number) => ({
    type: 1, components: [{ type: 4, custom_id, label, style: 1, required: true, max_length }],
  });
  return { type: 9, data: { custom_id: `gn:tower:proof:${attemptId}`, title: "Preuve visible au vote",
    components: [
      field("proof_link", "Lien de ton message dans le salon Défis", 200),
      field("proof_text", "Décris ta réalisation", 800),
      field("publication", "Partager au général si réussite ? OUI/NON", 3),
    ],
  } };
}
function proofInput(data: z.infer<typeof componentDataSchema>, guildId: string, channelId: string) {
  const fields = data.components?.flatMap(row => row.components) ?? [];
  const keys = fields.map(field => field.custom_id);
  if (keys.length !== 3 || new Set(keys).size !== 3 || !["proof_link", "proof_text", "publication"].every(key => keys.includes(key))) return null;
  const values = Object.fromEntries(fields.map(field => [field.custom_id, field.value.trim()]));
  const match = /^https:\/\/discord\.com\/channels\/([0-9]{16,20})\/([0-9]{16,20})\/([0-9]{16,20})$/.exec(values.proof_link);
  const publication = values.publication.toUpperCase();
  if (!match || match[1] !== guildId || match[2] !== channelId || !values.proof_text || values.proof_text.length > 800 || !["OUI", "NON"].includes(publication)) return null;
  return { proofText: values.proof_text, proofChannelId: match[2], proofMessageId: match[3], publicationConsent: publication === "OUI" };
}
type State = Extract<Awaited<ReturnType<typeof getTowerChallengeState>>, { status: "STATE" }>;
function renderState(state: State) {
  const latest = state.attempts[0];
  const history = state.attempts.map(attempt => `**${attempt.title}** — ${attempt.status === "ASSIGNED" ? "à réaliser" : attempt.status === "SUBMITTED" ? "en vote" : attempt.status === "APPROVED" ? "réussi" : "refusé"}`).join("\n");
  const details = latest ? `\n\n${latest.instructions.slice(0, state.attempts.length === 1 ? 1500 : 900)}\nGain : +${latest.rewardFloors} étage(s) · À réaliser avant <t:${Math.floor(latest.expiresAt.getTime() / 1000)}:f>.` : "\nAucun défi attribué pour le moment.";
  const buttons = [button("Actualiser", "gn:tower:mine")];
  if (latest?.status === "ASSIGNED") buttons.push(button("Déposer ma preuve", `gn:tower:proof:${latest.id}`, 1));
  if (latest?.status === "SUBMITTED") buttons.push(button("Voir le résultat", `gn:tower:settle:${latest.id}`, 1));
  const components: DiscordActionRow[] = [{ type: 1, components: buttons }];
  if (state.attempts.length > 1) components.push({ type: 1, components: state.attempts.slice(0,5).map((attempt, index) =>
    button(`Défi ${index + 1} : ${attempt.title.slice(0,60)}`, `gn:tower:view:${attempt.id}`)) });
  return { content: `🏰 **Étage ${state.floor}**\n${history}${details}`.slice(0,1900), components };
}
type TeamState = Extract<Awaited<ReturnType<typeof getTeamDailyTowerChallenge>>, { status: "TEAM_CHALLENGE" }>;
function renderTeamState(state: TeamState) {
  const { team, attempt } = state;
  const phase = attempt.status === "ASSIGNED" ? "à réaliser" : attempt.status === "SUBMITTED" ? "en vote" : attempt.status === "APPROVED" ? "réussi" : "refusé";
  const buttons: ReturnType<typeof button>[] = [];
  if (attempt.status === "ASSIGNED" && !state.joined) buttons.push(button("Je participe", `gn:tower:join:${attempt.id}`, 1));
  if (attempt.status === "ASSIGNED" && state.joined) buttons.push(button("Déposer la preuve", `gn:tower:proof:${attempt.id}`, 1));
  if (attempt.status === "SUBMITTED" && state.joined) buttons.push(button("Voir le résultat", `gn:tower:settle:${attempt.id}`, 1));
  buttons.push(button("Mes équipes", "gn:tower:teams"));
  const reward = state.joined && attempt.status === "APPROVED"
    ? state.pendingReward ? " Ta récompense personnelle sera créditée demain, après la remise à zéro du plafond parisien."
      : " Tes étages personnels sont crédités."
    : state.joined ? " Tu participes à ce défi."
      : " Rejoins le défi pour participer à sa récompense.";
  const details = `🏰 **Défi quotidien · ${team.name}**\n**${attempt.title}** — ${phase}\n${attempt.instructions}\n\n${team.memberCount} membre(s) actif(s) · ${state.participantCount} participant(s) confirmé(s) · +${attempt.rewardFloors} étage(s) personnel(s) chacun après validation.${reward}\nDeux réussites récompensées par jour, solo et équipe confondus. Défi attribué jusqu’au <t:${Math.floor(attempt.expiresAt.getTime() / 1000)}:f>.`;
  return { content: details.slice(0, 1900), components: [{ type: 1 as const, components: buttons.slice(0, 5) }] };
}
function renderSeasonVote(result: Awaited<ReturnType<typeof getTowerSeasonVote>>, userId: string) {
  if (result.status === "NO_FINALISTS") return { content: "Il n’y a pas encore assez de finalistes actifs pour ouvrir un vote de saison." };
  if (result.status !== "VOTE_OPEN" && result.status !== "VOTE_CLOSED") return { content: "Le vote de saison n’est pas accessible." };
  const candidates = [...result.candidates];
  const closed = result.status === "VOTE_CLOSED";
  if (closed) candidates.sort((a,b)=>b.votes-a.votes || a.displayName.localeCompare(b.displayName));
  const leader = candidates[0];
  const tiedAtTop = leader ? candidates.filter(candidate=>candidate.votes===leader.votes).length > 1 : false;
  const winnerId = leader && leader.votes > 0 && !tiedAtTop ? leader.userId : null;
  const resultSummary = !leader || leader.votes === 0
    ? "Aucun bulletin — aucune distinction attribuée"
    : tiedAtTop ? "Égalité en tête — aucune distinction attribuée" : "Résultat final";
  const rows = candidates.map((candidate,index)=>(
    (index+1)+". **"+candidate.displayName+"** — +"+candidate.rewardFloors+" étage(s)"
      +(closed ? " · "+candidate.votes+" vote(s)"+(candidate.userId===winnerId ? " · 🏆 Distinction de saison" : "") : "")
  ));
  const content = "🗳️ **Vote communautaire — "+result.season.name+"**\n"
    +(closed ? resultSummary : "Choisis un finaliste avant <t:"+Math.floor(result.closesAt.getTime()/1000)+":f>")
    +"\n\n"+(rows.join("\n") || "Aucun finaliste actif.");
  if (closed || result.myCandidateUserId) return { content };
  const buttons = result.candidates.filter(candidate=>candidate.userId!==userId)
    .map(candidate=>button("Voter : "+candidate.displayName.slice(0,55),"gn:tower:season-ballot:"+result.voteId+":"+candidate.userId));
  const components: DiscordActionRow[] = [];
  for (let index=0;index<buttons.length;index+=5) components.push({type:1,components:buttons.slice(index,index+5)});
  return { content, components };
}

const feedback: Record<string, string> = {
  SEASON_VOTE_SAVED: "Ton vote de saison est enregistré.",
  SEASON_VOTE_ALREADY_CAST: "Tu as déjà voté pour cette saison.",
  SEASON_VOTE_SELF: "Tu ne peux pas voter pour toi-même.",
  SEASON_VOTE_CLOSED: "Le vote de saison est terminé.",
  SEASON_VOTE_NOT_OPEN: "Le vote de saison n’est pas encore ouvert.",
  COOLDOWN: "Tu as déjà reçu un défi récemment. Le prochain sera disponible 12 heures après son attribution.",
  NO_CHALLENGE: "Aucun défi n’est disponible pour tes jeux pour le moment.",
  SUBMITTED: "Ta preuve est enregistrée.",
  VOTED: "Ton vote est enregistré.",
  ALREADY_VOTED: "Tu as déjà voté pour cette preuve.",
  SELF_VOTE: "Tu ne peux pas voter pour ta propre preuve.",
  OPEN: "Le vote est encore ouvert pendant sa fenêtre de 24 heures.",
  TEAM_NEEDS_PARTICIPANTS: "Il faut au moins deux membres confirmés avant de déposer la preuve d'équipe.",
  JOINED: "Tu participes à ce défi d'équipe.",
  DAILY_LIMIT: "Tu as atteint tes deux réussites récompensées pour cette journée.",
  APPROVED: "Défi validé ! Ton étage a été mis à jour.",
  REJECTED: "La preuve n’a pas obtenu trois votes et une majorité favorable dans les 24 heures.",
  EXPIRED: "Le délai de 48 heures pour déposer cette preuve est terminé.",
  CONFLICT: "Une autre preuve est déjà enregistrée pour ce défi.",
  CLOSED: "Cette action est fermée pour ce défi.",
};

/** Exclusivement appelé après la vérification Ed25519 du corps brut dans discord-interactions. */
export function handleSignedTowerInteraction(body: unknown, timestamp: string | null): InteractionOutput {
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return { status: 400 };
  const i = parsed.data;
  const seconds = Number(timestamp);
  if (!timestamp || !Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300
    || i.application_id !== process.env.DISCORD_CLIENT_ID || (i.type !== 2 && i.message.author.id !== i.application_id)
    || i.guild_id !== process.env.TOWER_DISCORD_GUILD_ID || (i.type !== 2 && i.channel_id !== process.env.TOWER_DISCORD_CHANNEL_ID)) return { status: 400 };
  if (i.channel_id !== process.env.TOWER_DISCORD_CHANNEL_ID) return quiet("Utilise cette commande dans le salon des défis de la Tour.");
  const commandName = i.type === 2 ? i.data.options[0].name : null;
  const customId = i.type === 2 ? "gn:tower:" + (commandName === "defi" ? "claim" : commandName === "progression" ? "mine" : commandName === "vote" ? "season-vote" : commandName === "equipe" ? "teams" : "leaderboard") : i.data.custom_id;
  const action = /^gn:tower:(claim|mine|leaderboard|season-vote|teams)$/.exec(customId);
  const seasonBallot = /^gn:tower:season-ballot:([a-zA-Z0-9_-]{1,64}):([a-zA-Z0-9_-]{1,64})$/.exec(customId);
  const proof = /^gn:tower:proof:([a-zA-Z0-9_-]{1,64})$/.exec(customId);
  const view = /^gn:tower:view:([a-zA-Z0-9_-]{1,64})$/.exec(customId);
  const vote = /^gn:tower:vote:([a-zA-Z0-9_-]{1,64}):(yes|no)$/.exec(customId);
  const settle = /^gn:tower:settle:([a-zA-Z0-9_-]{1,64})$/.exec(customId);
  const team = /^gn:tower:team:([a-zA-Z0-9_-]{1,64})$/.exec(customId);
  const joinTeam = /^gn:tower:join:([a-zA-Z0-9_-]{1,64})$/.exec(customId);
  if ((!action && !proof && !view && !vote && !settle && !seasonBallot && !team && !joinTeam) || (i.type === 5 && !proof) || (i.type === 3 && i.data.component_type !== 2)) return { status: 400 };
  if (process.env.TOWER_CHALLENGES_ENABLED !== "true") return quiet("Les défis de la Tour ne sont pas encore ouverts.");
  if (i.type === 3 && proof) return { status: 200, body: proofModal(proof[1]) };
  const submittedProof = i.type === 5 ? proofInput(i.data, i.guild_id, i.channel_id) : null;
  if (i.type === 5 && !submittedProof) return { status: 400 };
  return { status: 200, body: { type: 5, data: { flags: 64 } }, runTower: async () => {
    let response: { content: string; components?: DiscordActionRow[] } = { content: "Les défis ne sont pas accessibles pour ton compte sur ce serveur." };
    try {
      const actor = await resolveTowerDiscordActor({ guildId: i.guild_id, discordId: i.member.user.id, username: i.member.user.username });
      if (actor) {
        if (action?.[1] === "leaderboard") {
          const board = await getTowerSeasonLeaderboard(actor);
          if (board.status === "LEADERBOARD") {
            const rows = board.entries.length
              ? board.entries.map((entry, index) => (index + 1) + ". <@" + entry.discordId + "> — +" + entry.rewardFloors + " étage(s)").join("\n")
              : "Aucun étage gagné sur cette période pour le moment.";
            const period = "<t:" + Math.floor(board.season.startAt.getTime() / 1000) + ":D> — <t:" + Math.floor(board.season.endAt.getTime() / 1000) + ":D>";
            response.content = "🏆 **Classement The Tower — " + board.season.name + "**\n"
              + (board.season.active ? "Trimestre en cours" : "Intersaison · dernier classement") + " · " + period + "\n\n" + rows;
          }
        } else if (action?.[1] === "season-vote") {
          response = renderSeasonVote(await getTowerSeasonVote(actor), actor.userId);
        } else if (seasonBallot) {
          const result = await castTowerSeasonVote({ ...actor, voteId: seasonBallot[1], candidateUserId: seasonBallot[2] });
          response = { content: feedback[result.status] ?? response.content };
          if (result.status === "SEASON_VOTE_SAVED" || result.status === "SEASON_VOTE_ALREADY_CAST") {
            response = renderSeasonVote(await getTowerSeasonVote(actor), actor.userId);
            response.content = feedback[result.status] + "\n\n" + response.content;
          }
        } else if (action?.[1] === "teams") {
          const result = await listDiscordTowerTeams(actor);
          if (result.status === "TEAMS" && result.teams.length) {
            response = {
              content: "🏰 **Choisis ton équipe** — son défi est attribué une fois par jour à Paris et partagé par tous ses membres.",
              components: Array.from({ length: Math.ceil(result.teams.length / 5) }, (_, index) => ({
                type: 1 as const,
                components: result.teams.slice(index * 5, index * 5 + 5).map(teamInfo => button(teamInfo.name.slice(0, 80), "gn:tower:team:" + teamInfo.id)),
              })),
            };
          } else response.content = "Tu n’as pas d’équipe accessible ou le mode équipes n’est pas activé pour cette communauté.";
        } else if (team) {
          const result = await getTeamDailyTowerChallenge({ ...actor, teamId: team[1] });
          if (result.status === "TEAM_CHALLENGE") response = renderTeamState(result);
          else response.content = result.status === "NO_CHALLENGE"
            ? "Aucun défi d’équipe n’est dans le catalogue. Un administrateur peut importer le pack avec /tower-admin importer-equipe."
            : feedback[result.status] ?? response.content;
        } else if (joinTeam) {
          const result = await joinTowerTeamChallenge({ ...actor, attemptId: joinTeam[1] });
          response.content = feedback[result.status] ?? response.content;
          if (result.status === "JOINED") {
            const state = await getTeamDailyTowerChallenge({ ...actor, teamId: result.teamId });
            if (state.status === "TEAM_CHALLENGE") { response = renderTeamState(state); response.content = feedback.JOINED + "\n\n" + response.content; }
          }
        } else if (action?.[1] === "claim" || action?.[1] === "mine" || view) {
          const claim = action?.[1] === "claim" ? await claimSoloTowerChallenge({ ...actor, requestKey: i.id }) : null;
          if (!claim || claim.status === "CLAIMED") {
            const state = await getTowerChallengeState({ ...actor, ...(view ? { attemptId: view[1] } : claim?.status === "CLAIMED" ? { attemptId: claim.attemptId } : {}) });
            if (state.status === "STATE") response = renderState(state);
          } else response.content = feedback[claim.status] ?? response.content;
        } else if (submittedProof && proof) {
          const source = await getTowerProofMessage({ channelId: submittedProof.proofChannelId, messageId: submittedProof.proofMessageId, deadline: new Date(Date.now() + 10000) });
          if (!source.ok || source.data.authorId !== i.member.user.id) response.content = "Je ne peux pas confirmer que ce message de preuve t’appartient.";
          else {
            const saved = await submitTowerChallengeProof({ ...actor, attemptId: proof[1], ...submittedProof });
            response.content = feedback[saved.status] ?? response.content;
          }
        } else if (vote) {
          const result = await voteTowerChallenge({ ...actor, attemptId: vote[1], approve: vote[2] === "yes" });
          response.content = feedback[result.status] ?? response.content;
        } else if (settle) {
          const result = await settleTowerChallenge({ ...actor, attemptId: settle[1] });
          response.content = result.status === "APPROVED" && "userRewarded" in result && !result.userRewarded
            ? "Défi validé ! Tu as atteint tes deux réussites récompensées pour aujourd’hui ; ta récompense sera créditée demain, après minuit à Paris."
            : feedback[result.status] ?? response.content;
        }
      }
    } catch {
      logger.error("discord-tower", "Le traitement du défi a échoué ; aucune confirmation de réussite envoyée.");
      response = { content: "Impossible de confirmer cette action pour le moment. Consulte ta progression avant de réessayer." };
    }
    const sent = await editSetupResponse({ applicationId: i.application_id, token: i.token, ...response, deadline: new Date(Date.now() + 10000) });
    if (!sent.ok) logger.error("discord-tower", "Réponse privée non livrée.", { kind: sent.kind });
  } };
}
