"use client";

import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ghost";

export default function Button({
  className = "",
  variant = "primary",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const variantClass =
    variant === "primary"
      ? "bg-emerald-500 text-zinc-950 hover:shadow-[0_0_20px_rgba(52,211,153,0.55)]"
      : "border border-zinc-700 bg-zinc-900 text-zinc-100 hover:shadow-[0_0_16px_rgba(161,161,170,0.25)]";

  return (
    <button
      className={`group relative inline-flex items-center justify-center overflow-hidden rounded-full px-5 py-2 text-sm font-medium transition-all duration-200 hover:scale-[1.03] active:scale-95 disabled:opacity-60 disabled:hover:scale-100 disabled:hover:shadow-none ${variantClass} ${className}`}
      {...props}
    >
      <span
        aria-hidden
        className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
      />
      <span className="relative">{children}</span>
    </button>
  );
}
