import type { ReactNode } from "react";

/**
 * AWESOMIC SURFACE PRIMITIVES
 *
 * The design system is defined by three radii and hairline elevation. There are
 * exactly TWO card surfaces, and no component may set its own border radius,
 * border colour, or shadow.
 *
 * Why this constraint exists: an earlier audit found EIGHT competing card
 * treatments and nine border radii across the admin. Every hand-rolled surface
 * was a place dark mode (then) and the palette (now) could drift out of sync.
 * Composing from these primitives makes that structurally impossible.
 *
 * ELEVATION RULE: 1px solid Cloud (#ececee). Never a drop shadow on a content
 * surface. The only permitted shadow is the inset highlight on a dark button.
 */

type SurfaceProps = {
  children: ReactNode;
  className?: string;
};

/**
 * Elevated card on the Paper canvas.
 * radius 36px · 1px Cloud border · white fill · 28px padding.
 */
export function Card({ children, className = "" }: SurfaceProps) {
  return (
    <section
      className={`rounded-[36px] border border-[#ececee] bg-white p-6 sm:p-7 ${className}`}
    >
      {children}
    </section>
  );
}

/**
 * Recessed surface inside a Card — for stat tiles, nested groups, and list
 * wells. Same hairline treatment, quieter fill, tighter radius.
 */
export function CardInner({ children, className = "" }: SurfaceProps) {
  return (
    <div className={`rounded-[12px] border border-[#ececee] bg-[#fafafa] p-4 ${className}`}>
      {children}
    </div>
  );
}

/**
 * Dark feature block. Inverts the page for pain-point lists and the private
 * studio RAB, where the change of surface signals "internal only".
 */
export function DarkPanel({ children, className = "" }: SurfaceProps) {
  return (
    <section className={`rounded-[36px] bg-[#18181b] p-6 text-white sm:p-7 ${className}`}>
      {children}
    </section>
  );
}

/** Card header: title, optional description, optional trailing action. */
export function CardHeader({
  title,
  description,
  action,
  tone = "light",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "light" | "dark";
}) {
  const isDark = tone === "dark";
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2
          className={`text-lg font-semibold tracking-tight ${
            isDark ? "text-white" : "text-[#09090b]"
          }`}
        >
          {title}
        </h2>
        {description ? (
          <p className={`mt-0.5 text-[13px] font-normal ${isDark ? "text-[#a1a1aa]" : "text-[#52525b]"}`}>
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

/**
 * Badge — the three permitted variants.
 *
 * `ember` is reserved for high-priority signals only (active production, critical
 * alert, credential chip). Using it elsewhere breaks the system's restraint,
 * which is why it is a named variant rather than an arbitrary colour prop.
 */
export function Badge({
  children,
  variant = "outline",
  className = "",
}: {
  children: ReactNode;
  variant?: "outline" | "filled" | "ember";
  className?: string;
}) {
  const styles: Record<string, string> = {
    outline: "border border-[#ececee] bg-transparent text-[#18181b]",
    filled: "bg-[#3f3f46] text-[#fafafa]",
    ember: "bg-[#ff5a00] text-white",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[12px] px-2 py-1 text-[12px] font-medium ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Label/value pair used inside KPI tiles. */
export function StatTile({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string;
  hint?: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <CardInner>
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#71717a]">{label}</p>
      <p
        className={`mt-1.5 font-mono text-lg font-semibold tabular-nums ${
          emphasis ? "text-[#ff5a00]" : "text-[#09090b]"
        }`}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[12px] text-[#52525b]">{hint}</p> : null}
    </CardInner>
  );
}
