"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import type { ComponentProps, ReactNode } from "react";

const MotionLink = motion.create(Link);

const VARIANT_CLASSES = {
  primary: "bg-accent text-accent-foreground hover:bg-accent-hover",
  secondary:
    "border-2 border-border bg-surface text-foreground hover:bg-surface-hover hover:border-border-hover",
  destructive:
    "border border-destructive/40 text-destructive hover:bg-destructive/10",
  ghost: "text-muted hover:text-foreground",
} as const;

const SIZE_CLASSES = {
  md: "px-5 py-3 text-base sm:py-2.5 sm:text-sm",
  sm: "px-4 py-2.5 text-sm",
} as const;

type Variant = keyof typeof VARIANT_CLASSES;
type Size = keyof typeof SIZE_CLASSES;

interface SharedProps {
  variant?: Variant;
  size?: Size;
  fullWidthOnMobile?: boolean;
  className?: string;
  children: ReactNode;
}

function buildClassName({
  variant = "secondary",
  size = "md",
  fullWidthOnMobile,
  className = "",
}: SharedProps) {
  return [
    `gn-button gn-button-${variant} inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:pointer-events-none`,
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    fullWidthOnMobile ? "w-full sm:w-auto" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

// Framer Motion redéfinit onDrag*/onAnimation* avec une signature différente
// de celle des events DOM natifs — on les exclut pour éviter le conflit de
// types en spreadant les props natives dans motion.button / MotionLink.
type MotionConflictingProps =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

type ButtonProps = SharedProps &
  Omit<ComponentProps<"button">, "className" | "children" | MotionConflictingProps>;

export function Button({
  variant,
  size,
  fullWidthOnMobile,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      className={buildClassName({
        variant,
        size,
        fullWidthOnMobile,
        className,
        children,
      })}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

type ButtonLinkProps = SharedProps &
  Omit<
    ComponentProps<typeof Link>,
    "className" | "children" | MotionConflictingProps
  >;

export function ButtonLink({
  variant,
  size,
  fullWidthOnMobile,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <MotionLink
      whileTap={{ scale: 0.97 }}
      className={buildClassName({
        variant,
        size,
        fullWidthOnMobile,
        className,
        children,
      })}
      {...rest}
    >
      {children}
    </MotionLink>
  );
}
