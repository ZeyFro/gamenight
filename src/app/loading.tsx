import { Logo } from "@/components/Logo";

/**
 * Loading global (Suspense racine, Sprint 1 v2) — Server Component
 * volontairement : pas de Framer Motion ici, seulement des animations CSS
 * Tailwind natives (`animate-spin`/`animate-pulse`), qui s'affichent dès le
 * premier octet streamé par le serveur, avant même l'hydratation JS —
 * cohérent avec le rôle de `loading.tsx` (affiché PENDANT le chargement,
 * ne doit pas lui-même attendre un bundle client pour apparaître).
 */
export default function Loading() {
  return (
    <div
      role="status"
      className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16"
    >
      <div
        aria-hidden
        className="h-10 w-10 animate-spin rounded-full border-2 border-border border-t-accent"
      />
      <Logo className="animate-pulse text-base" />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}
