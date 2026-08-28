"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import {
  matchFamilyImportBatch,
  type FamilyImportGameSummary,
  type FamilyImportSuggestion,
} from "@/app/profil/family-import-actions";
import { FAMILY_IMPORT_BATCH_SIZE, parseGameNamesFromText } from "@/lib/family-import";

interface PendingItem {
  id: string;
  input: string;
  suggestion: FamilyImportSuggestion | null;
  confidence: number;
}

type Phase = "idle" | "analyzing" | "done";

/**
 * Import "biblio Steam Family" par copier-coller (PR "Import biblio Steam
 * Family via copier-coller") : Steam ne permet à aucune app tierce
 * d'accéder automatiquement à une bibliothèque familiale partagée (voir
 * commentaire détaillé dans `src/lib/family-import.ts`), donc l'utilisateur
 * colle lui-même une liste de noms — l'app matche via IGDB et importe.
 *
 * Traitement par lots côté client (`FAMILY_IMPORT_BATCH_SIZE`), pas un
 * seul appel géant : même raison que les backfills coop de la PR
 * "Optimisation build" — une biblio de 300 jeux dépasserait largement une
 * fenêtre de requête serveur unique, et le batching donne une vraie
 * progress bar en prime (chaque lot fait avancer l'UI immédiatement).
 */
export function FamilyImportForm() {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [total, setTotal] = useState(0);
  const [processed, setProcessed] = useState(0);
  const [imported, setImported] = useState<FamilyImportGameSummary[]>([]);
  const [duplicates, setDuplicates] = useState<FamilyImportGameSummary[]>([]);
  const [pending, setPending] = useState<PendingItem[]>([]);
  const [showImported, setShowImported] = useState(true);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  async function handleAnalyze() {
    const names = parseGameNamesFromText(text);
    if (names.length === 0) {
      toast.error("Aucun nom de jeu détecté dans le texte collé.");
      return;
    }

    setPhase("analyzing");
    setTotal(names.length);
    setProcessed(0);
    setImported([]);
    setDuplicates([]);
    setPending([]);

    const importedAcc: FamilyImportGameSummary[] = [];
    const duplicatesAcc: FamilyImportGameSummary[] = [];
    const pendingAcc: PendingItem[] = [];

    for (let i = 0; i < names.length; i += FAMILY_IMPORT_BATCH_SIZE) {
      const batch = names.slice(i, i + FAMILY_IMPORT_BATCH_SIZE);
      const results = await matchFamilyImportBatch(batch);

      for (const r of results) {
        if (r.outcome === "imported" && r.game) {
          importedAcc.push(r.game);
        } else if (r.outcome === "duplicate" && r.game) {
          duplicatesAcc.push(r.game);
        } else {
          pendingAcc.push({
            id: `${r.input}-${pendingAcc.length}`,
            input: r.input,
            suggestion: r.suggestion ?? null,
            confidence: r.confidence ?? 0,
          });
        }
      }

      setImported([...importedAcc]);
      setDuplicates([...duplicatesAcc]);
      setPending([...pendingAcc]);
      setProcessed((p) => p + batch.length);
    }

    setPhase("done");
    toast.success(
      `${importedAcc.length} jeu${importedAcc.length === 1 ? "" : "x"} importé${importedAcc.length === 1 ? "" : "s"}${pendingAcc.length > 0 ? `, ${pendingAcc.length} à confirmer` : ""}`
    );
  }

  async function retryItem(item: PendingItem, newName: string) {
    setRetryingIds((prev) => new Set(prev).add(item.id));
    try {
      const [result] = await matchFamilyImportBatch([newName]);
      if (!result) return;

      if (result.outcome === "needsConfirmation") {
        setPending((prev) =>
          prev.map((p) =>
            p.id === item.id
              ? { ...p, input: newName, suggestion: result.suggestion ?? null, confidence: result.confidence ?? 0 }
              : p
          )
        );
        return;
      }

      setPending((prev) => prev.filter((p) => p.id !== item.id));
      if (result.outcome === "imported" && result.game) {
        setImported((prev) => [...prev, result.game!]);
        toast.success(`${result.game.name} importé`);
      } else if (result.outcome === "duplicate" && result.game) {
        setDuplicates((prev) => [...prev, result.game!]);
        toast.info(`${result.game.name} était déjà dans ta bibliothèque`);
      }
    } finally {
      setRetryingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  function skipItem(id: string) {
    setPending((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted">
        Steam ne permet pas aux apps tierces d&apos;accéder automatiquement
        aux bibliothèques familiales partagées. Voici une alternative
        rapide (~1 minute) :
      </p>

      <ol className="flex flex-col gap-1 text-sm text-muted">
        <li>1. Ouvre le client Steam (bureau ou mobile) et va dans ta Bibliothèque.</li>
        <li>
          2. Filtre par famille ou active « Grouper par bibliothèque »
          dans le menu des filtres pour voir les jeux des autres membres.
        </li>
        <li>
          3. Note ou copie les noms des jeux qui t&apos;intéressent (pas
          de vrai copier-coller possible depuis le client Steam,
          contrairement à une page web).
        </li>
        <li>4. Colle-les ci-dessous, un jeu par ligne ou séparés par des virgules.</li>
      </ol>

      <a
        href="https://store.steampowered.com/account/familymanagement"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-accent underline underline-offset-2"
      >
        Ouvrir la gestion de ma Famille Steam →
      </a>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={"Portal 2\nStardew Valley\nHades, Hollow Knight, Terraria\n…"}
        rows={6}
        disabled={phase === "analyzing"}
        aria-label="Liste de jeux à importer"
        className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-60"
      />

      <Button
        type="button"
        variant="primary"
        onClick={handleAnalyze}
        disabled={phase === "analyzing" || text.trim().length === 0}
        fullWidthOnMobile
      >
        {phase === "analyzing" ? "Analyse en cours…" : "Analyser et importer"}
      </Button>

      {phase === "analyzing" && (
        <div className="flex flex-col gap-1.5">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-hover">
            <motion.div
              className="h-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${total > 0 ? (processed / total) * 100 : 0}%` }}
              transition={{ ease: "easeOut" }}
            />
          </div>
          <p className="text-xs text-muted">
            {processed}/{total} jeux analysés — {imported.length} importé
            {imported.length === 1 ? "" : "s"}, {pending.length} à confirmer
          </p>
        </div>
      )}

      {(phase === "done" || imported.length + duplicates.length + pending.length > 0) && (
        <div className="flex flex-col gap-4">
          {pending.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-warning">
                ⚠️ Non trouvés ({pending.length})
              </h3>
              <div className="flex flex-col gap-2">
                <AnimatePresence initial={false}>
                  {pending.map((item) => (
                    <PendingRow
                      key={item.id}
                      item={item}
                      retrying={retryingIds.has(item.id)}
                      onRetry={(name) => retryItem(item, name)}
                      onSkip={() => skipItem(item.id)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            </section>
          )}

          {imported.length > 0 && (
            <CollapsibleSection
              title={`✅ Importés automatiquement (${imported.length})`}
              open={showImported}
              onToggle={() => setShowImported((v) => !v)}
            >
              <GameSummaryList games={imported} />
            </CollapsibleSection>
          )}

          {duplicates.length > 0 && (
            <CollapsibleSection
              title={`❌ Doublons ignorés (${duplicates.length})`}
              open={showDuplicates}
              onToggle={() => setShowDuplicates((v) => !v)}
            >
              <GameSummaryList games={duplicates} />
            </CollapsibleSection>
          )}
        </div>
      )}
    </div>
  );
}

function CollapsibleSection({
  title,
  open,
  onToggle,
  children,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center justify-between text-sm font-semibold text-foreground"
      >
        {title}
        <span className="text-muted">{open ? "▲" : "▼"}</span>
      </button>
      {open && children}
    </section>
  );
}

function GameSummaryList({ games }: { games: FamilyImportGameSummary[] }) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {games.map((game) => (
        <div key={game.id} className="flex flex-col gap-1">
          <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-surface-hover">
            {game.coverUrl && (
              <Image
                src={game.coverUrl}
                alt={game.name}
                fill
                sizes="120px"
                className="object-cover"
              />
            )}
          </div>
          <p className="truncate text-xs text-foreground">{game.name}</p>
        </div>
      ))}
    </div>
  );
}

function PendingRow({
  item,
  retrying,
  onRetry,
  onSkip,
}: {
  item: PendingItem;
  retrying: boolean;
  onRetry: (name: string) => void;
  onSkip: () => void;
}) {
  const [name, setName] = useState(item.input);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40 }}
    >
      <Card className="flex flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
          />
          {item.suggestion && (
            <Badge tone="warning">
              {Math.round(item.confidence * 100)}% « {item.suggestion.name} »
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={retrying || name.trim().length === 0}
            onClick={() => onRetry(name.trim())}
          >
            {retrying ? "Recherche…" : "Chercher à nouveau"}
          </Button>
          <Link
            href={`/bibliotheque/ajouter?name=${encodeURIComponent(name.trim())}`}
            className="inline-flex items-center rounded-lg border border-border bg-surface px-4 py-2 text-sm text-foreground transition-colors hover:bg-surface-hover"
          >
            Ajouter manuellement
          </Link>
          <button
            type="button"
            onClick={onSkip}
            className="text-sm text-muted underline decoration-dotted hover:text-foreground"
          >
            Skipper
          </button>
        </div>
      </Card>
    </motion.div>
  );
}
