import Link from "next/link";
import { auth } from "@/auth";
import { Logo } from "@/components/Logo";
import { HeaderNavLinks } from "@/components/HeaderNavLinks";

export async function Header() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="shrink-0">
          <Logo />
        </Link>
        {session?.user && (
          <nav className="hidden items-center gap-1 sm:flex">
            <HeaderNavLinks />
          </nav>
        )}
      </div>
    </header>
  );
}
