import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { ERROR_RETENTION_DAYS, listServerErrors } from "@/lib/error-log";
import { Card } from "@/components/ui/Card";
import { pageMetadata } from "@/lib/page-title";

export const dynamic = "force-dynamic";
export const metadata = pageMetadata("Erreurs serveur · Admin");

const dateFr = (value: Date) =>
  new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "medium", timeZone: "Europe/Paris" }).format(value);

/**
 * Journal d'erreurs serveur (audit du 23/11/2026) : lecture seule, administrateurs seulement (même convention que /admin/journal :
 * un non-administrateur est renvoyé à l'accueil, avant toute lecture). Aucun texte saisi par un utilisateur : le message a été
 * nettoyé et tronqué à l'écriture.
 */
export default async function ServerErrorsPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/");
  const rows = await listServerErrors(100);
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <Link href="/admin" className="text-sm text-accent underline-offset-4 hover:underline">← Administration</Link>
      <header>
        <h1 className="text-2xl font-semibold text-foreground">Erreurs serveur</h1>
        <p className="mt-1 text-sm text-muted">
          Les 100 dernières erreurs des tâches planifiées, du bot Discord et des envois, regroupées par type : une erreur répétée
          augmente son compteur. Conservées {ERROR_RETENTION_DAYS} jours. Aucune donnée personnelle, aucun secret.
        </p>
      </header>
      <Card>
        {rows.length === 0 ? <p className="text-sm text-muted">Aucune erreur enregistrée.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Erreurs serveur, de la plus récente à la plus ancienne</caption>
              <thead>
                <tr className="border-b border-border text-muted">
                  <th scope="col" className="py-2 pr-3">Dernière fois (Paris)</th>
                  <th scope="col" className="py-2 pr-3">Fois</th>
                  <th scope="col" className="py-2 pr-3">Contexte</th>
                  <th scope="col" className="py-2 pr-3">Code</th>
                  <th scope="col" className="py-2">Message</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-border align-top">
                    <td className="whitespace-nowrap py-2 pr-3">{dateFr(row.lastAt)}<br /><span className="text-xs text-muted">1re : {dateFr(row.createdAt)}</span></td>
                    <td className="py-2 pr-3 tabular-nums">{row.count}</td>
                    <td className="break-all py-2 pr-3 font-mono text-xs">{row.context}{row.route ? <><br />{row.route}</> : null}</td>
                    <td className="break-all py-2 pr-3 font-mono text-xs">{row.code}</td>
                    <td className="break-words py-2 font-mono text-xs">{row.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </main>
  );
}
