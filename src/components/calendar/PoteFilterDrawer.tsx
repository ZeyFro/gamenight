"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ColorDot } from "@/components/ColorDot";

interface FilterableUser {
  id: string;
  discordName: string;
  color: string;
}

/**
 * Panneau "potes affichés" (vue Collective, PR 4/4 sous-PR 1) — même
 * pattern Radix Dialog bottom-sheet + `router.replace` immédiat que
 * `GameFilterDrawer` (`?potes=id1,id2`, absent = tout le monde affiché).
 */
export function PoteFilterDrawer({
  users,
  visibleUserIds,
}: {
  users: FilterableUser[];
  /** `null` = pas de filtre dans l'URL = tout le monde visible. */
  visibleUserIds: string[] | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const selected = visibleUserIds ?? users.map((u) => u.id);

  function update(nextIds: string[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (nextIds.length === users.length || nextIds.length === 0) {
      params.delete("potes");
    } else {
      params.set("potes", nextIds.join(","));
    }
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  function toggle(userId: string) {
    update(
      selected.includes(userId)
        ? selected.filter((id) => id !== userId)
        : [...selected, userId]
    );
  }

  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <Button type="button" variant="secondary" size="sm" className="gap-2">
          Potes
          {visibleUserIds && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-foreground">
              {selected.length}
            </span>
          )}
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[75vh] overflow-y-auto rounded-t-2xl border-t border-border bg-surface p-4 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border sm:p-6"
          >
            <div className="flex items-center justify-between">
              <Dialog.Title className="text-lg font-semibold text-foreground">
                Potes affichés
              </Dialog.Title>
              <button
                type="button"
                onClick={() => update(users.map((u) => u.id))}
                className="text-sm text-accent hover:underline"
              >
                Tout afficher
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-1">
              {users.map((user) => (
                <label
                  key={user.id}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 text-base text-foreground hover:bg-surface-hover sm:text-sm"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(user.id)}
                    onChange={() => toggle(user.id)}
                    className="h-5 w-5 rounded border-border accent-accent"
                  />
                  <ColorDot color={user.color} />
                  {user.discordName}
                </label>
              ))}
            </div>

            <Dialog.Close asChild>
              <Button type="button" variant="primary" fullWidthOnMobile className="mt-5 w-full">
                Voir le calendrier
              </Button>
            </Dialog.Close>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
