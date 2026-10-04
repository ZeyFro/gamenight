import type { SVGProps } from "react";

/**
 * Icônes du design « centre de commande » — SVG 24×24 au trait, couleur
 * héritée (`currentColor`), décoratives (`aria-hidden`) : le libellé
 * accessible est toujours porté par le bouton qui les contient. Jeu
 * volontairement minimal et indépendant des icônes existantes de l'app.
 */

function Svg({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9.5h13V10" />
      <path d="M10 19.5v-5h4v5" />
    </Svg>
  );
}

export function CalendarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </Svg>
  );
}

export function TrophyIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M8 4h8v5a4 4 0 0 1-8 0V4Z" />
      <path d="M8 6H4.5v1.5A3.5 3.5 0 0 0 8 11M16 6h3.5v1.5A3.5 3.5 0 0 1 16 11" />
      <path d="M12 13v4M8.5 20h7M10 17h4" />
    </Svg>
  );
}

export function UserIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </Svg>
  );
}

export function UsersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3 19.5c.6-3 3-4.7 6-4.7s5.4 1.7 6 4.7" />
      <path d="M16 5.8a3 3 0 0 1 0 5.4M18.5 15.2c1.5.6 2.4 2 2.7 4.3" />
    </Svg>
  );
}

export function BoltIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z" fill="currentColor" />
    </Svg>
  );
}

export function FlameIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M12 3c.5 3-2 4.5-3.5 6.5A6 6 0 0 0 12 21a6 6 0 0 0 5-9.2c-.6 1.2-1.5 1.8-2.4 2C15.4 10.6 14.4 5.5 12 3Z" />
    </Svg>
  );
}

export function CrownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="m4 8 4.5 4L12 5l3.5 7L20 8l-1.5 10h-13L4 8Z" />
    </Svg>
  );
}

export function ClockIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}
