import type { ReactNode } from "react";

/**
 * The single empty-state primitive.
 *
 * WHY THIS EXISTS
 * ---------------
 * The admin previously invented a plausible-looking placeholder whenever data
 * was absent — most dangerously a hardcoded Rp 25,000,000 contract value and a
 * fabricated client contact on the project page. That made the dashboard
 * untrustworthy: every number might be fiction.
 *
 * This component replaces every such fallback. When there is no data, the UI
 * says so plainly and tells the operator what to do next. An honest zero is
 * always better than a confident guess.
 */

export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = "neutral",
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  tone?: "neutral" | "warning";
}) {
  const accent = tone === "warning" ? "text-[#ff5a00]" : "text-[#71717a]";

  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-[36px] border border-dashed border-[#d4d4d8] px-6 py-10 text-center">
      {icon ? <div className={accent}>{icon}</div> : null}
      <p className="text-sm font-semibold text-[#18181b]">{title}</p>
      {description ? (
        <p className="max-w-md text-xs leading-relaxed text-[#71717a]">
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1.5">{action}</div> : null}
    </div>
  );
}
