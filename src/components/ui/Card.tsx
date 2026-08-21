import type { ComponentProps } from "react";

export function Card({
  className = "",
  glow = false,
  children,
  ...rest
}: ComponentProps<"div"> & { glow?: boolean }) {
  return (
    <div
      className={`rounded-xl border border-border bg-surface p-6 sm:p-8 ${
        glow ? "transition-all duration-200 hover:card-glow" : ""
      } ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
