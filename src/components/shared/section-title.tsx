import { cn } from "@/lib/utils";

export function SectionTitle({
  eyebrow,
  children,
  className,
}: {
  eyebrow?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(className)}>
      {eyebrow && <p className="eyebrow mb-5">{eyebrow}</p>}
      <h2 className="section-heading">{children}</h2>
    </div>
  );
}
