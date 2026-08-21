"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

const TONE_CLASSES = {
  accent: "bg-accent/15 text-accent",
  neutral: "bg-white/5 text-muted",
  warning: "bg-warning/15 text-warning",
  destructive: "bg-destructive/15 text-destructive",
} as const;

export function Badge({
  tone = "neutral",
  glow = false,
  animate = false,
  className = "",
  children,
}: {
  tone?: keyof typeof TONE_CLASSES;
  glow?: boolean;
  animate?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const classes = `inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-semibold ${TONE_CLASSES[tone]} ${glow ? "badge-glow" : ""} ${className}`;

  if (!animate) {
    return <span className={classes}>{children}</span>;
  }

  return (
    <motion.span
      key={String(children)}
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      className={classes}
    >
      {children}
    </motion.span>
  );
}
