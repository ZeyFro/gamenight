import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/current-user";
import { prisma } from "@/lib/prisma";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Stagger, StaggerItem } from "@/components/motion";
import {
  addGameStatType,
  addSuperlative,
  deleteGameStatType,
  deleteSuperlative,
  updateGameStatType,
  updateSuperlative,
} from "../actions";

const TYPE_LABELS: Record<string, string> = {
  INT: "Nombre entier",
  FLOAT: "Nombre décimal",
  BOOL: "Oui/Non",
};

const RULE_LABELS: Record<string, string> = {
  MAX: "Valeur la plus haute",
  MIN: "Valeur la plus basse",
  TRUE_COUNT: "Vrai (oui)",
};

const SELECT_CLASS =
  "rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none";
const INPUT_CLASS =
  "rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder:text-faint focus:border-accent focus:outline-none";

export default async function GameStatsAdminPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { gameId } = await params;

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    include: {
      statTypes: {
        include: { superlatives: { orderBy: { createdAt: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!game) notFound();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <div>
        <Link
          href="/admin/jeux-stats"
          className="text-sm text-muted hover:text-foreground hover:underline"
        >
          ← Stats &amp; superlatifs
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">
          {game.name}
        </h1>
      </div>

      <Card>
        <form action={addGameStatType} className="flex flex-col gap-4">
          <input type="hidden" name="gameId" value={game.id} />
          <p className="text-sm font-medium text-foreground">Nouvelle stat</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="new-key">
                Clé (technique)
              </label>
              <input
                id="new-key"
                name="key"
                required
                placeholder="ex. morts"
                className={INPUT_CLASS}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="new-label">
                Nom affiché
              </label>
              <input
                id="new-label"
                name="label"
                required
                placeholder="ex. Nombre de morts"
                className={INPUT_CLASS}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted" htmlFor="new-type">
                Type
              </label>
              <select
                id="new-type"
                name="type"
                defaultValue="INT"
                className={SELECT_CLASS}
              >
                {Object.entries(TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <label
              htmlFor="new-higherIsBetter"
              className="flex min-h-11 items-center gap-2 text-sm text-foreground"
            >
              <input
                id="new-higherIsBetter"
                name="higherIsBetter"
                type="checkbox"
                defaultChecked
                className="h-5 w-5 rounded border-border accent-accent"
              />
              Plus c&apos;est haut, mieux c&apos;est
            </label>
          </div>
          <Button type="submit" variant="primary" fullWidthOnMobile>
            Ajouter la stat
          </Button>
        </form>
      </Card>

      {game.statTypes.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            Aucune stat configurée pour {game.name}.
          </p>
        </Card>
      ) : (
        <Stagger className="flex flex-col gap-4">
          {game.statTypes.map((stat) => (
            <StaggerItem key={stat.id}>
              <Card className="flex flex-col gap-4">
                <form
                  action={updateGameStatType}
                  className="flex flex-col gap-3"
                >
                  <input type="hidden" name="id" value={stat.id} />
                  <input type="hidden" name="gameId" value={game.id} />
                  <div className="flex flex-col gap-1">
                    <label
                      className="text-xs text-muted"
                      htmlFor={`label-${stat.id}`}
                    >
                      Nom affiché ({stat.key})
                    </label>
                    <input
                      id={`label-${stat.id}`}
                      name="label"
                      defaultValue={stat.label}
                      required
                      className={INPUT_CLASS}
                    />
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <select
                      name="type"
                      defaultValue={stat.type}
                      className={SELECT_CLASS}
                    >
                      {Object.entries(TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                      <input
                        name="higherIsBetter"
                        type="checkbox"
                        defaultChecked={stat.higherIsBetter}
                        className="h-5 w-5 rounded border-border accent-accent"
                      />
                      Plus c&apos;est haut, mieux c&apos;est
                    </label>
                    <Button type="submit" variant="secondary" size="sm">
                      Enregistrer
                    </Button>
                  </div>
                </form>

                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted">
                    Superlatifs
                  </p>
                  {stat.superlatives.length === 0 && (
                    <p className="text-sm text-muted">
                      Aucun superlatif pour cette stat.
                    </p>
                  )}

                  {stat.superlatives.map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap items-end gap-2 rounded-lg border border-border bg-background p-3"
                    >
                      <form
                        action={updateSuperlative}
                        className="flex flex-1 flex-wrap items-end gap-2"
                      >
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="gameId" value={game.id} />
                        <div className="flex min-w-32 flex-1 flex-col gap-1">
                          <label
                            className="text-xs text-muted"
                            htmlFor={`name-${s.id}`}
                          >
                            Nom
                          </label>
                          <input
                            id={`name-${s.id}`}
                            name="name"
                            defaultValue={s.name}
                            required
                            className={`${INPUT_CLASS} bg-surface`}
                          />
                        </div>
                        <select
                          name="rule"
                          defaultValue={s.rule}
                          className={`${SELECT_CLASS} bg-surface`}
                        >
                          {Object.entries(RULE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <div className="flex flex-col gap-1">
                          <label
                            className="text-xs text-muted"
                            htmlFor={`xp-${s.id}`}
                          >
                            XP
                          </label>
                          <input
                            id={`xp-${s.id}`}
                            name="xpReward"
                            type="number"
                            min={0}
                            defaultValue={s.xpReward}
                            className={`${INPUT_CLASS} w-20 bg-surface`}
                          />
                        </div>
                        <Button type="submit" variant="secondary" size="sm">
                          ✓
                        </Button>
                      </form>
                      <form action={deleteSuperlative}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="gameId" value={game.id} />
                        <Button type="submit" variant="destructive" size="sm">
                          ✕
                        </Button>
                      </form>
                    </div>
                  ))}

                  <form
                    action={addSuperlative}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="gameId" value={game.id} />
                    <input type="hidden" name="gameStatTypeId" value={stat.id} />
                    <input
                      name="name"
                      placeholder="ex. 🐛 Bouffé par le grouille"
                      required
                      className={`min-w-0 flex-1 ${INPUT_CLASS}`}
                    />
                    <select name="rule" defaultValue="MAX" className={SELECT_CLASS}>
                      {Object.entries(RULE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <input
                      name="xpReward"
                      type="number"
                      min={0}
                      defaultValue={20}
                      className={`${INPUT_CLASS} w-16`}
                    />
                    <Button type="submit" variant="secondary" size="sm">
                      + Ajouter
                    </Button>
                  </form>
                </div>

                <form action={deleteGameStatType} className="border-t border-border pt-3">
                  <input type="hidden" name="id" value={stat.id} />
                  <input type="hidden" name="gameId" value={game.id} />
                  <Button
                    type="submit"
                    variant="destructive"
                    size="sm"
                    fullWidthOnMobile
                  >
                    Supprimer cette stat (et ses superlatifs)
                  </Button>
                </form>
              </Card>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </div>
  );
}
