"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Avatar } from "@/components/ui/Avatar";
import { formatDurationFr } from "@/lib/wallclock";
import { CHAT_REACTION_EMOJIS } from "@/lib/validations";
import { RATE_LIMIT_ERROR_KEY, RATE_LIMIT_MESSAGE } from "@/lib/rate-limit";
import type { ChatMessageDTO } from "@/lib/chat";
import {
  getChatMessagesAction,
  sendChatMessageAction,
  toggleReactionAction,
} from "@/app/chat/actions";

const POLL_INTERVAL_MS = 10_000;
const LONG_PRESS_MS = 500;

/**
 * Sprint 5 (FEATURE 2, Chat in-app) — cœur du chat : liste des messages
 * (polling toutes les 10s, PAS de websockets, cf. spec) + input +
 * réactions longue-pression. Réutilisé tel quel pour le canal global
 * (dans `ChatPanel`) et pour l'onglet "💬 Chat" d'une soirée (embarqué
 * directement, sans wrapper dialog) — seul `sessionId` change.
 */
export function ChatMessages({
  sessionId,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  currentUserColor,
  initialMessages,
}: {
  sessionId: string | null;
  currentUserId: string;
  currentUserName: string;
  currentUserAvatar: string | null;
  currentUserColor: string;
  initialMessages: ChatMessageDTO[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState("");
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function refresh() {
    setRefreshing(true);
    const fresh = await getChatMessagesAction(sessionId);
    setNow(Date.now());
    if (fresh) setMessages(fresh);
    setRefreshing(false);
  }

  useEffect(() => {
    const interval = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");

    // Mise à jour optimiste (Sprint 5 suite, I2) — la bulle apparaît
    // immédiatement, un id temporaire suffit puisqu'elle n'est jamais
    // affichée plus de quelques centaines de ms : soit `refresh()` la
    // remplace par la vraie ligne (envoi réussi), soit elle est retirée
    // (échec, cf. plus bas).
    const tempId = `optimistic-${Math.random().toString(36).slice(2)}`;
    const optimisticMessage: ChatMessageDTO = {
      id: tempId,
      content,
      createdAtIso: new Date().toISOString(),
      userId: currentUserId,
      discordName: currentUserName,
      discordAvatar: currentUserAvatar,
      color: currentUserColor,
      reactions: [],
    };
    setMessages((prev) => [...prev, optimisticMessage]);

    const formData = new FormData();
    formData.set("content", content);
    formData.set("sessionId", sessionId ?? "");

    startTransition(async () => {
      const result = await sendChatMessageAction(formData);
      if (!result.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        toast.error(
          result.error === RATE_LIMIT_ERROR_KEY ? RATE_LIMIT_MESSAGE : "Une erreur est survenue."
        );
        return;
      }
      await refresh();
    });
  }

  function startLongPress(messageId: string) {
    longPressTimer.current = setTimeout(() => setReactionPickerFor(messageId), LONG_PRESS_MS);
  }

  function cancelLongPress() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  function react(messageId: string, emoji: string) {
    setReactionPickerFor(null);
    const formData = new FormData();
    formData.set("messageId", messageId);
    formData.set("emoji", emoji);
    startTransition(async () => {
      await toggleReactionAction(formData);
      await refresh();
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-end px-1">
        <span
          className={`text-[10px] text-faint transition-opacity ${refreshing ? "opacity-100" : "opacity-0"}`}
        >
          Actualisation…
        </span>
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-1 py-2">
        {messages.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">
            Aucun message pour l&apos;instant — lance la discussion !
          </p>
        ) : (
          messages.map((m) => {
            const isMine = m.userId === currentUserId;
            const reactionCounts = new Map<string, number>();
            for (const r of m.reactions) reactionCounts.set(r.emoji, (reactionCounts.get(r.emoji) ?? 0) + 1);

            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
                className={`flex items-end gap-2 ${isMine ? "flex-row-reverse" : ""}`}
              >
                {!isMine && <Avatar src={m.discordAvatar} alt={m.discordName} size={28} />}
                <div className={`flex max-w-[75%] flex-col gap-1 ${isMine ? "items-end" : "items-start"}`}>
                  {!isMine && <span className="px-1 text-[10px] text-faint">{m.discordName}</span>}
                  <div className="relative">
                    <div
                      onPointerDown={() => startLongPress(m.id)}
                      onPointerUp={cancelLongPress}
                      onPointerLeave={cancelLongPress}
                      className={`rounded-2xl px-3 py-2 text-sm break-words select-none ${
                        isMine ? "text-accent-foreground" : "text-foreground"
                      }`}
                      style={{
                        backgroundColor: isMine
                          ? "var(--accent)"
                          : `color-mix(in srgb, ${m.color} 22%, var(--surface-hover))`,
                      }}
                    >
                      {m.content}
                    </div>

                    <AnimatePresence>
                      {reactionPickerFor === m.id && (
                        <motion.div
                          initial={{ opacity: 0, scale: 0.8, y: 4 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8 }}
                          className={`absolute -top-11 z-10 flex gap-1 rounded-full border border-border bg-surface p-1 shadow-lg ${
                            isMine ? "right-0" : "left-0"
                          }`}
                        >
                          {CHAT_REACTION_EMOJIS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => react(m.id, emoji)}
                              className="flex h-8 w-8 items-center justify-center rounded-full text-lg transition-transform hover:scale-125"
                            >
                              {emoji}
                            </button>
                          ))}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {reactionCounts.size > 0 && (
                    <div className={`flex flex-wrap gap-1 px-1 ${isMine ? "justify-end" : ""}`}>
                      {[...reactionCounts.entries()].map(([emoji, count]) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => react(m.id, emoji)}
                          className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[11px]"
                        >
                          {emoji} {count}
                        </button>
                      ))}
                    </div>
                  )}

                  <span className="px-1 text-[10px] text-faint">
                    il y a {formatDurationFr(Math.max(0, now - new Date(m.createdAtIso).getTime()))}
                  </span>
                </div>
              </motion.div>
            );
          })
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex shrink-0 gap-2 border-t border-border p-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={500}
          placeholder="Écrire un message…"
          className="min-w-0 flex-1 rounded-full border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Envoyer"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground transition-opacity disabled:opacity-40"
        >
          ➤
        </button>
      </form>
    </div>
  );
}
