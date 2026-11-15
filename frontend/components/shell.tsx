"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Activity, BarChart3, BookOpen, Calculator, ChevronsLeft, ChevronsRight, FileText, History, Landmark, LineChart,
  Menu, SlidersHorizontal, Target, X,
} from "lucide-react";
import { useApi, type Provenance } from "@/lib/api";
import { usePortfolios } from "@/lib/portfolio-store";
import { cn } from "@/lib/utils";
import { Badge, Select, Tip } from "@/components/ui/primitives";

export const NAV = [
  { href: "/", label: "Market Overview", icon: Activity },
  { href: "/curve", label: "Treasury Yield Curve", icon: LineChart },
  { href: "/policy", label: "Monetary Policy Simulator", icon: Landmark },
  { href: "/bond", label: "Bond Pricing Laboratory", icon: Calculator },
  { href: "/portfolio", label: "Portfolio Risk Analytics", icon: BarChart3 },
  { href: "/history", label: "Historical Fed Scenarios", icon: History },
  { href: "/optimize", label: "Portfolio Optimization", icon: Target },
  { href: "/research", label: "Research & Insights", icon: FileText },
  { href: "/methodology", label: "Methodology", icon: BookOpen },
];

type Status = {
  data_mode: string;
  snapshot_retrieved_at_utc: string;
  treasury: Provenance;
  fred: Record<string, Provenance>;
  errors: Record<string, string>;
};

function DataStatus() {
  const { data, error } = useApi<Status>("/api/data/status");
  if (error) return <Badge tone="neg">Backend offline</Badge>;
  if (!data) return <Badge>Connecting…</Badge>;
  const t = data.treasury;
  const live = t.mode === "live";
  return (
    <Tip
      content={
        <div className="space-y-1">
          <div>
            <b>Data mode:</b> {data.data_mode}
          </div>
          <div>
            <b>Treasury curve:</b> {t.mode.toUpperCase()} · last observation {t.last_observation} · retrieved {t.retrieved_at_utc}
          </div>
          {t.note && <div className="text-muted">{t.note}</div>}
          <div>
            <b>FRED series:</b> {Object.values(data.fred).filter((p) => p.mode === "live").length} live /{" "}
            {Object.keys(data.fred).length} loaded (others from bundled snapshot retrieved {data.snapshot_retrieved_at_utc})
          </div>
          {Object.keys(data.errors).length > 0 && <div className="text-warn">Refresh errors: {Object.keys(data.errors).join(", ")}</div>}
        </div>
      }
    >
      <span className="flex items-center gap-1.5">
        <Badge tone={live ? "live" : "snapshot"}>
          <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-pos" : "bg-warn")} />
          <span className="hidden sm:inline">{live ? "Live official data" : "Snapshot data (not live)"}</span>
          <span className="sm:hidden">{live ? "Live" : "Snapshot"}</span>
        </Badge>
        <span className="hidden text-2xs text-muted md:inline">UST curve {t.last_observation}</span>
      </span>
    </Tip>
  );
}

function PortfolioSelector() {
  const { portfolios, activeId, setActiveId, ready } = usePortfolios();
  if (!ready && !portfolios.length) return <span className="text-2xs text-muted">Loading portfolios…</span>;
  return (
    <div className="flex items-center gap-1.5">
      <span className="hidden text-2xs uppercase tracking-wide text-muted sm:inline">Active portfolio</span>
      <Select
        ariaLabel="Active portfolio"
        value={activeId}
        onChange={setActiveId}
        className="max-w-[220px]"
        options={portfolios.map((p) => ({ value: p.id, label: `${p.kind === "user" ? "★ " : ""}${p.name}` }))}
      />
    </div>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  useEffect(() => setMobileOpen(false), [path]);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("monetary.sidebar") === "1");
    } catch {}
  }, []);
  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem("monetary.sidebar", c ? "0" : "1");
      } catch {}
      return !c;
    });
  };
  const current = NAV.find((n) => (n.href === "/" ? path === "/" : path.startsWith(n.href)));

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex flex-col border-r border-border bg-[#0a1220] transition-all",
          collapsed ? "w-14" : "w-60",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        <div className="flex h-12 items-center gap-2 border-b border-border px-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent/20 font-mono text-sm font-bold text-accent">M</div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="font-mono text-sm font-bold tracking-[0.2em]">MONETARY</div>
              <div className="text-[10px] text-muted">Fixed Income Risk Terminal</div>
            </div>
          )}
          <button className="ml-auto text-muted lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2" aria-label="Sections">
          {NAV.map((n, i) => {
            const active = n === current;
            const Icon = n.icon;
            const link = (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2.5 rounded px-2 py-1.5 text-xs transition-colors",
                  active ? "bg-accent/15 text-fg" : "text-muted hover:bg-panel2 hover:text-fg",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon className={cn("h-4 w-4 shrink-0", active && "text-accent")} />
                {!collapsed && (
                  <span className="truncate">
                    <span className="mr-1.5 font-mono text-[10px] text-muted">{i + 1}</span>
                    {n.label}
                  </span>
                )}
              </Link>
            );
            return collapsed ? (
              <Tip key={n.href} content={n.label}>
                {link}
              </Tip>
            ) : (
              link
            );
          })}
        </nav>
        <button
          onClick={toggle}
          className="hidden items-center gap-2 border-t border-border p-3 text-2xs text-muted hover:text-fg lg:flex"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
          {!collapsed && "Collapse"}
        </button>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className={cn("flex min-w-0 flex-1 flex-col transition-all", collapsed ? "lg:pl-14" : "lg:pl-60")}>
        <header className="sticky top-0 z-20 flex h-12 items-center gap-3 border-b border-border bg-bg/95 px-3 backdrop-blur">
          <button className="text-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <SlidersHorizontal className="hidden h-3.5 w-3.5 text-accent sm:block" />
            <h1 className="hidden truncate text-sm font-semibold sm:block">{current?.label ?? "MONETARY"}</h1>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <PortfolioSelector />
            <DataStatus />
          </div>
        </header>
        <main className="flex-1 p-3 md:p-4">{children}</main>
        <footer className="border-t border-border px-4 py-2 text-[10px] text-muted">
          MONETARY is a research and education tool. Scenario outputs are hypothetical and based on stated assumptions; nothing here is a
          forecast or investment advice. Data: U.S. Department of the Treasury; FRED, Federal Reserve Bank of St. Louis; Board of Governors of
          the Federal Reserve System.
        </footer>
      </div>
    </div>
  );
}
