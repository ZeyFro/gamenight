"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";

interface Voter {
  id: string;
  discordName: string;
  discordAvatar: string | null;
  color: string;
}

const MAX_VISIBLE = 5;
const AVATAR_SIZE = 28;

/**
 * Pile d'avatars des voteurs d'une proposition (fix UX PR 30, remonté
 * après test prod — on voyait "3 votes" mais pas qui). Visible par tout
 * le monde, pas juste le créateur ou l'auteur du vote : esprit
 * collaboratif déjà établi partout ailleurs dans l'app (dispos, biblio du
 * groupe, tierlist visible par tous…), pas de raison de traiter les votes
 * différemment.
 *
 * Deux interactions distinctes plutôt qu'une seule : `title` natif sur
 * chaque avatar (déjà géré par `Avatar`) donne un vrai tooltip par pseudo
 * au survol desktop, sans rien construire de plus. Le tap (mobile ET
 * desktop) ouvre une popup listant tout le monde — un tooltip par avatar
 * n'a pas de sens au tactile (pas de `:hover`, et les avatars empilés
 * sont trop petits pour un tap précis par personne), donc la pile entière
 * est le déclencheur d'une seule liste complète.
 */
export function VoterAvatars({ voters }: { voters: Voter[] }) {
  if (voters.length === 0) return null;

  const visible = voters.slice(0, MAX_VISIBLE);
  const overflow = voters.length - visible.length;

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="flex items-center -space-x-2"
          aria-label={`A voté : ${voters.map((v) => v.discordName).join(", ")}`}
        >
          {visible.map((voter) => (
            <Avatar
              key={voter.id}
              src={voter.discordAvatar}
              alt={voter.discordName}
              size={AVATAR_SIZE}
              ringColor={voter.color}
            />
          ))}
          {overflow > 0 && (
            <span
              className="flex items-center justify-center rounded-full bg-surface-hover text-[11px] font-semibold text-muted ring-2 ring-surface"
              style={{ width: AVATAR_SIZE, height: AVATAR_SIZE }}
            >
              +{overflow}
            </span>
          )}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
          >
            <Dialog.Title className="text-lg font-semibold text-foreground">
              A voté ({voters.length})
            </Dialog.Title>
            <ul className="mt-4 flex flex-col gap-3">
              {voters.map((voter) => (
                <li key={voter.id} className="flex items-center gap-3">
                  <Avatar
                    src={voter.discordAvatar}
                    alt={voter.discordName}
                    size={36}
                    ringColor={voter.color}
                  />
                  <span className="text-sm text-foreground">{voter.discordName}</span>
                </li>
              ))}
            </ul>
            <Dialog.Close asChild>
              <Button type="button" variant="secondary" fullWidthOnMobile className="mt-5 w-full">
                Fermer
              </Button>
            </Dialog.Close>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
