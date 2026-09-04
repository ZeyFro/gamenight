"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import { ChatMessages } from "@/components/chat/ChatMessages";
import type { ChatMessageDTO } from "@/lib/chat";

/**
 * Canal global (Sprint 5, FEATURE 2) — icône 💬 dans le header, à côté de
 * la cloche. Panneau plein écran sur mobile, glissant depuis la droite
 * sur desktop (même famille que `GameFilterDrawer`, mais plein écran
 * plutôt que bottom-sheet sur mobile — demandé explicitement pour le
 * chat, cf. spec).
 */
export function ChatPanel({
  currentUserId,
  initialMessages,
}: {
  currentUserId: string;
  initialMessages: ChatMessageDTO[];
}) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Chat"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg text-foreground transition-colors hover:bg-surface-hover"
        >
          💬
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
        <Dialog.Content asChild aria-describedby={undefined}>
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
            className="fixed inset-0 z-50 flex flex-col bg-surface sm:inset-y-0 sm:right-0 sm:left-auto sm:w-full sm:max-w-sm sm:border-l sm:border-border"
          >
            <div className="flex items-center justify-between border-b border-border p-4">
              <Dialog.Title className="text-lg font-semibold text-foreground">💬 Chat</Dialog.Title>
              <Dialog.Close asChild>
                <button
                  type="button"
                  aria-label="Fermer"
                  className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-hover"
                >
                  ✕
                </button>
              </Dialog.Close>
            </div>
            <div className="flex min-h-0 flex-1 flex-col p-2">
              <ChatMessages
                sessionId={null}
                currentUserId={currentUserId}
                initialMessages={initialMessages}
              />
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
