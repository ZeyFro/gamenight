/* Magic UI official registry source; MIT; see THIRD_PARTY_NOTICES.md. */
"use client"


import { cn } from "./utils"

interface MeteorsProps {
  number?: number
  minDelay?: number
  maxDelay?: number
  minDuration?: number
  maxDuration?: number
  angle?: number
  className?: string
}

export const Meteors = ({
  number = 20,
  minDelay = 0.2,
  maxDelay = 1.2,
  minDuration = 2,
  maxDuration = 10,
  angle = 215,
  className,
}: MeteorsProps) => {
  // Dispersion déterministe : même rendu serveur/client, sans lecture de
  // window ni second rendu pour initialiser des styles aléatoires.
  const meteorStyles = Array.from({ length: number }, (_, index) => ({
      "--angle": -angle + "deg",
      top: "-5%",
      left: `${(index * 37 + 13) % 100}%`,
      animationDelay: ((index * 7 % 13) / 13 * (maxDelay - minDelay) + minDelay) + "s",
      animationDuration: ((index * 11 % 17) / 17 * (maxDuration - minDuration) + minDuration) + "s",
    }))

  return (
    <>
      {[...meteorStyles].map((style, idx) => (
        // Meteor Head
        <span
          key={idx}
          style={{ ...style }}
          className={cn(
            "animate-meteor pointer-events-none absolute size-0.5 rotate-(--angle) rounded-full bg-zinc-500 shadow-[0_0_0_1px_#ffffff10]",
            className
          )}
        >
          {/* Meteor Tail */}
          <div className="pointer-events-none absolute top-1/2 -z-10 h-px w-12.5 -translate-y-1/2 bg-linear-to-r from-zinc-500 to-transparent" />
        </span>
      ))}
    </>
  )
}
