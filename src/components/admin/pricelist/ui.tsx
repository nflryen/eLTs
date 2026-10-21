"use client";

/*
 * Shared form furniture for the pricelist CMS.
 *
 * WHY THESE EXIST
 * ---------------
 * Three panels (Kategori, Paket, Add-on) each carry an inline create/edit form
 * with the same label/input/hint geometry. Writing that markup three times is
 * how the same field ends up 4px taller in one tab than another. These are the
 * smallest primitives that remove the repetition without inventing a component
 * library: a labelled field wrapper, the two input types, and the button styles.
 *
 * COLOUR COMES FROM TOKENS, NOT HEX. `bg-snow`, `border-cloud`, `text-graphite`,
 * `text-fog`, `text-ash` and `bg-paper` are generated from the Awesomic custom
 * properties in globals.css, so the CMS cannot drift from the rest of the admin.
 */

import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  htmlFor,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <label htmlFor={htmlFor} className="mb-1 block text-[11px] font-medium text-iron">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1 text-[10px] leading-snug text-ash">{hint}</p> : null}
    </div>
  );
}

const INPUT_CLASS =
  "w-full rounded-[14px] border border-cloud bg-snow px-3 py-2 text-sm text-graphite outline-none transition-colors placeholder:text-ash focus:border-iron disabled:bg-paper disabled:text-fog";

export function TextInput({ className, ...props }: ComponentProps<"input">) {
  return <input {...props} className={cn(INPUT_CLASS, className)} />;
}

export function TextArea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(INPUT_CLASS, "resize-y leading-relaxed", className)} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cn(INPUT_CLASS, "pr-8", className)} />;
}

export function PrimaryButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[14px] bg-graphite px-3 py-2 text-xs font-medium text-snow transition-colors hover:bg-obsidian disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  );
}

export function GhostButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[14px] px-3 py-2 text-xs font-medium text-fog transition-colors hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
    />
  );
}

/** Square icon-only control used in the per-row action cluster. */
export function IconButton({
  label,
  tone = "neutral",
  className,
  ...props
}: ComponentProps<"button"> & { label: string; tone?: "neutral" | "danger" }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      {...props}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-30",
        tone === "danger"
          ? "text-ash hover:bg-red-50 hover:text-red-600"
          : "text-fog hover:bg-paper hover:text-graphite",
        className,
      )}
    />
  );
}

/**
 * Active/archive switch.
 *
 * "Arsip" rather than "hapus" on purpose: deactivating a row hides it from the
 * public configurator while keeping it intact, which is the only reversible
 * option an operator has once a price has been quoted.
 */
export function ActiveToggle({
  isActive,
  disabled,
  onToggle,
}: {
  isActive: boolean;
  disabled?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={isActive}
      onClick={onToggle}
      title={isActive ? "Sembunyikan dari halaman publik" : "Tampilkan di halaman publik"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[12px] border px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        isActive
          ? "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          : "border-cloud bg-paper text-fog hover:bg-cloud",
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          isActive ? "bg-emerald-600" : "bg-ash",
        )}
        aria-hidden
      />
      {isActive ? "Aktif" : "Diarsipkan"}
    </button>
  );
}

/** Two-line row heading: the name, then the slug/identifier beneath it. */
export function RowIdentity({
  name,
  meta,
  badge,
}: {
  name: string;
  meta: string;
  badge?: string | null;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <p className="truncate text-sm font-medium text-graphite">{name}</p>
        {badge ? (
          <span className="shrink-0 rounded-[12px] bg-ember/10 px-1.5 py-0.5 text-[10px] font-medium text-ember">
            {badge}
          </span>
        ) : null}
      </div>
      <p className="truncate font-mono text-[10px] text-ash">{meta}</p>
    </div>
  );
}

/** The inline error strip every panel renders above its list. */
export function ErrorStrip({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p
      role="alert"
      className="rounded-[14px] border border-red-200 bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700"
    >
      {message}
    </p>
  );
}
