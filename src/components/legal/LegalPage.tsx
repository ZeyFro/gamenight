import type { ReactNode } from "react";
import Link from "next/link";
import { LEGAL_LINKS, LEGAL_TO_COMPLETE, LEGAL_UPDATE_NOTICE } from "@/lib/legal-pages";

/**
 * Gabarit des pages légales. Pas de `<main>` : le layout racine en fournit déjà un
 * (landmarks imbriqués = constat V3-10 de l'audit).
 */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <p className="text-sm text-muted">{LEGAL_UPDATE_NOTICE}</p>
        <nav aria-label="Pages légales" className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="text-accent underline underline-offset-2">{link.label}</Link>
          ))}
        </nav>
      </header>
      <article className="flex flex-col gap-6 text-sm leading-relaxed text-muted [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:ml-5 [&_li]:list-disc [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left [&_th]:text-foreground">
        {children}
      </article>
    </div>
  );
}

/** Champ renseigné par l'éditeur, ou mention visible « À COMPLÉTER ». */
export function LegalValue({ value }: { value: string | null }) {
  if (value) return <span className="text-foreground">{value}</span>;
  return <span className="rounded bg-warning/20 px-1 font-semibold text-foreground" data-legal-missing="true">{LEGAL_TO_COMPLETE}</span>;
}

export function LegalEmail({ email }: { email: string | null }) {
  if (!email) return <LegalValue value={null} />;
  return <a href={`mailto:${email}`} className="text-accent underline underline-offset-2">{email}</a>;
}
