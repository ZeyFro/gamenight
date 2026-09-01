"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useState, useTransition, type FormEvent, type SVGProps } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { updateGame } from "@/app/actions";
import { Button } from "@/components/ui/Button";
import { RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";

interface EditableGame {
  id: string;
  name: string;
  source: string;
  isCoop: boolean;
  minPlayers: number | null;
  maxPlayers: number | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  joueurs_invalide:
    "Le nombre de joueurs minimum doit être entre 1 et 100, et le maximum (si renseigné) doit être supérieur ou égal au minimum.",
  nom_requis: "Le nom ne peut pas être vide.",
  not_owned: "Tu ne possèdes pas ce jeu.",
  not_found: "Jeu introuvable.",
  unauthenticated: "Connecte-toi pour modifier un jeu.",
  rate_limited: RATE_LIMIT_MESSAGE,
};

const SOURCE_LABELS: Record<string, string> = { STEAM: "Steam", IGDB: "IGDB" };

export function EditGameDialog({ game }: { game: EditableGame }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(game.name);
  const [isCoop, setIsCoop] = useState(game.isCoop);
  const [minPlayers, setMinPlayers] = useState(game.minPlayers ?? 2);
  const [maxPlayers, setMaxPlayers] = useState<number | "">(
    game.maxPlayers ?? ""
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const editableName = game.source === "MANUAL";

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    const formData = new FormData();
    formData.set("gameId", game.id);
    if (editableName) formData.set("name", name);
    if (isCoop) formData.set("isCoop", "on");
    formData.set("minPlayers", String(minPlayers));
    if (maxPlayers !== "") formData.set("maxPlayers", String(maxPlayers));

    startTransition(async () => {
      const result = await updateGame(formData);
      if (result.ok) {
        toast.success("Jeu mis à jour");
        setOpen(false);
      } else {
        setError(
          ERROR_MESSAGES[result.error ?? ""] ?? "Une erreur est survenue."
        );
      }
    });
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={`Modifier ${game.name}`}
          title="Modifier"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-sm transition-colors hover:bg-accent/90"
        >
          <PencilIcon className="h-4 w-4" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
          >
            <Dialog.Title className="text-lg font-semibold text-foreground">
              Modifier {game.name}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Modifier les informations de {game.name}.
            </Dialog.Description>

            <form
              onSubmit={handleSubmit}
              className="mt-4 flex flex-col gap-4"
            >
              {editableName ? (
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="edit-name"
                    className="text-sm font-medium text-foreground"
                  >
                    Nom
                  </label>
                  <input
                    id="edit-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                  />
                </div>
              ) : (
                <p className="text-xs text-faint">
                  Le nom vient de {SOURCE_LABELS[game.source] ?? game.source}{" "}
                  et n&apos;est pas modifiable.
                </p>
              )}

              <label
                htmlFor="edit-isCoop"
                className="flex items-center gap-3 text-base text-foreground sm:text-sm"
              >
                <input
                  id="edit-isCoop"
                  type="checkbox"
                  checked={isCoop}
                  onChange={(e) => setIsCoop(e.target.checked)}
                  className="h-5 w-5 rounded border-border accent-accent"
                />
                Jouable en coop
              </label>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="edit-min"
                    className="text-sm font-medium text-foreground"
                  >
                    Joueurs minimum
                  </label>
                  <input
                    id="edit-min"
                    type="number"
                    min={1}
                    max={100}
                    required
                    value={minPlayers}
                    onChange={(e) => setMinPlayers(Number(e.target.value))}
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground focus:border-accent focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="edit-max"
                    className="text-sm font-medium text-foreground"
                  >
                    Joueurs maximum
                  </label>
                  <input
                    id="edit-max"
                    type="number"
                    min={minPlayers}
                    max={100}
                    value={maxPlayers}
                    onChange={(e) =>
                      setMaxPlayers(
                        e.target.value === "" ? "" : Number(e.target.value)
                      )
                    }
                    placeholder="Optionnel"
                    className="rounded-lg border border-border bg-background px-3 py-3 text-base text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex gap-3">
                <Dialog.Close asChild>
                  <Button type="button" variant="secondary" className="flex-1">
                    Annuler
                  </Button>
                </Dialog.Close>
                <Button
                  type="submit"
                  variant="primary"
                  disabled={isPending}
                  className="flex-1"
                >
                  {isPending ? "Sauvegarde…" : "Sauvegarder"}
                </Button>
              </div>
            </form>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PencilIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M13.586 2.586a2 2 0 0 1 2.828 2.828l-9.5 9.5a1 1 0 0 1-.39.242l-3.5 1.166a.5.5 0 0 1-.632-.632l1.166-3.5a1 1 0 0 1 .242-.39l9.5-9.5-9.5 9.5Zm1.414 1.414L5.5 13.5l-.834 2.5 2.5-.834 9.5-9.5-1.666-1.666Z" />
    </svg>
  );
}
