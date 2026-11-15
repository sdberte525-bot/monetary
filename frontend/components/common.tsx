"use client";
import { ExternalLink } from "lucide-react";
import type { Provenance } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Badge, InfoTip } from "@/components/ui/primitives";

export function Metric({
  label,
  value,
  sub,
  tip,
  valueClass,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tip: string;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-panel px-3 py-2", className)}>
      <div className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted">
        {label}
        <InfoTip text={tip} />
      </div>
      <div className={cn("num mt-0.5 text-lg font-semibold leading-tight", valueClass)}>{value}</div>
      {sub && <div className="mt-0.5 text-2xs text-muted">{sub}</div>}
    </div>
  );
}

export function SourceLine({ prov, extra, className }: { prov?: Provenance | null; extra?: string; className?: string }) {
  if (!prov) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5 text-[10px] text-muted", className)}>
      <span>Source:</span>
      {prov.url ? (
        <a href={prov.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-fg">
          {prov.source} <ExternalLink className="h-2.5 w-2.5" />
        </a>
      ) : (
        <span>{prov.source}</span>
      )}
      <Badge tone={prov.mode === "live" ? "live" : prov.mode === "user" ? "user" : "snapshot"}>
        {prov.mode === "live" ? "live" : prov.mode === "user" ? "user input" : "snapshot · not live"}
      </Badge>
      {prov.last_observation && <span>last obs. {prov.last_observation}</span>}
      {prov.retrieved_at_utc && <span>· retrieved {prov.retrieved_at_utc.replace("T", " ").replace("+00:00", " UTC")}</span>}
      {extra && <span>· {extra}</span>}
    </div>
  );
}

export function PageIntro({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 max-w-5xl text-xs leading-relaxed text-muted">{children}</p>;
}

export function Bullets({ items, className }: { items: string[]; className?: string }) {
  return (
    <ul className={cn("space-y-1 text-xs leading-relaxed", className)}>
      {items.map((s, i) => (
        <li key={i} className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}
