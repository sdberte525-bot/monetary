"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink } from "lucide-react";
import { useApi, TENORS, type PnlRow, type Provenance } from "@/lib/api";
import { usePortfolios } from "@/lib/portfolio-store";
import { downloadCsv } from "@/lib/csv";
import { fmtBp, fmtNum, fmtSignedPct, fmtUsd, pnlClass } from "@/lib/format";
import { G } from "@/lib/glossary";
import { Metric, PageIntro, SourceLine } from "@/components/common";
import { CategoryBarChart, TenorBarChart, TenorCurveChart, TimeSeriesChart } from "@/components/charts";
import { Badge, Button, Card, CardBody, CardHeader, DataTable, ErrorBox, Field, Input, Loading, Note, Td, Th } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Announcement = { date: string; title: string; url: string };
type Event = { id: string; name: string; window: { start: string; end: string }; window_rule: string; summary: string; announcements: Announcement[] };
type Observed = {
  start_observed: string; end_observed: string; yields_start_pct: Record<string, number | null>; yields_end_pct: Record<string, number | null>;
  changes_bp: Record<string, number | null>; spread_2s10s_bp: { start: number | null; end: number | null }; spread_3m10y_bp: { start: number | null; end: number | null };
  policy_start: { lower: number; upper: number; kind: string }; policy_end: { lower: number; upper: number; kind: string }; policy_change_bp: number;
  path: Record<string, number | string | null>[];
};
type EventDetail = { event: Event; observed: Observed; policy_changes_in_window: { effective_date: string; lower: number; upper: number; change_bp: number }[]; provenance: Provenance };
type Apply = {
  observed: Observed;
  hypothetical: { valuation_curve_as_of: string; settlement: string; shocks_bp: Record<string, number>; results: Record<string, { market_value_before: number; pnl_full: number; return_full: number; pnl_krd_approx: number; duration: number; dv01: number; by_security: PnlRow[] }>; disclaimer: string };
  assumptions: string[];
};
type MacroRows = { rows: Record<string, number | string | null>[] };


export default function HistoryPage() {
  const evs = useApi<{ events: Event[] }>("/api/history/events");
  const [id, setId] = useState("easing_2024");
  const ev = evs.data?.events.find((e) => e.id === id);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  useEffect(() => {
    setStart("");
    setEnd("");
  }, [id]);
  const s = start || ev?.window.start || "";
  const e = end || ev?.window.end || "";
  const custom = !!(start || end);
  const det = useApi<EventDetail>(ev ? `/api/history/events/${id}?start=${s}&end=${e}` : null);
  const { active } = usePortfolios();
  const applyBody = active && ev ? { event_id: id, start: s, end: e, portfolios: { [`${active.name} (active)`]: active.positions }, include_samples: true } : undefined;
  const ap = useApi<Apply>(applyBody ? "/api/history/apply" : null, applyBody, 200);
  const tl = useApi<MacroRows>("/api/macro/overview?start=2006-01-01");

  const refLines = useMemo(
    () => (evs.data?.events ?? []).map((x) => ({ x: x.announcements[0].date.slice(0, 7) + "-01", label: `'${x.announcements[0].date.slice(2, 4)}` })),
    [evs.data],
  );

  if (evs.error) return <ErrorBox error={evs.error} />;
  if (!evs.data || !ev) return <Loading />;
  const o = det.data?.observed;

  return (
    <div className="space-y-3">
      <PageIntro>
        Historical monetary-policy episodes using <b>actual</b> Treasury par-yield observations and FOMC target-rate data (FRED), with
        primary-source citations. Results are presented in three clearly separated layers: (1) observed market movements; (2) the{" "}
        <b>hypothetical</b> P&L of applying those observed changes to today&apos;s portfolios on today&apos;s curve; (3) any assumption used where
        data are missing. Layer 2 is a stress test, not a backtest.
      </PageIntro>

      <Card>
        <CardHeader title="Policy timeline" subtitle="Fed target (upper bound / point target), 2Y and 10Y Treasury yields, monthly. Amber lines mark the episodes below." />
        <CardBody>
          {tl.error && <ErrorBox error={tl.error} />}
          {!tl.data && !tl.error && <Loading />}
          {tl.data && (
            <TimeSeriesChart
              rows={tl.data.rows}
              height={250}
              yLabel="Percent"
              series={[{ key: "fed_target_upper", label: "Fed target (upper)" }, { key: "ust_2y", label: "2Y CMT (monthly avg)" }, { key: "ust_10y", label: "10Y CMT (monthly avg)" }]}
              refLines={refLines}
              caption="Percent. Sources: FRED DFEDTAR/DFEDTARU (target), DGS2/DGS10 (Treasury CMT). Target shown at month-end; yields are monthly averages."
            />
          )}
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-1.5">
        {evs.data.events.map((x) => (
          <Button key={x.id} size="sm" variant={x.id === id ? "default" : "outline"} onClick={() => setId(x.id)}>
            {x.name}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader
          title={ev.name}
          subtitle={ev.window_rule}
          right={
            <>
              <Field label="Window start"><Input type="date" value={s} onChange={(x) => setStart(x.target.value)} className="w-36" /></Field>
              <Field label="Window end"><Input type="date" value={e} onChange={(x) => setEnd(x.target.value)} className="w-36" /></Field>
              {custom && <Button size="sm" className="self-end" onClick={() => { setStart(""); setEnd(""); }}>Default window</Button>}
            </>
          }
        />
        <CardBody className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-3">
          <div className="space-y-2">
            <p className="text-xs leading-relaxed">{ev.summary}</p>
            {custom && <Badge tone="warn">custom window</Badge>}
            <div className="text-2xs font-semibold uppercase tracking-wide text-muted">Primary sources (Federal Reserve Board)</div>
            <ol className="space-y-1.5 border-l border-border pl-3">
              {ev.announcements.map((a) => (
                <li key={a.date + a.title} className="text-xs">
                  <span className="num text-accent">{a.date}</span> — {a.title}{" "}
                  <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-muted hover:text-fg">
                    source <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                </li>
              ))}
            </ol>
            {det.data && (
              <>
                <div className="text-2xs font-semibold uppercase tracking-wide text-muted">Target changes in window (FRED effective dates)</div>
                {det.data.policy_changes_in_window.length === 0 ? (
                  <div className="text-xs text-muted">None — the target was unchanged.</div>
                ) : (
                  <ul className="space-y-0.5 text-xs">
                    {det.data.policy_changes_in_window.map((c) => (
                      <li key={c.effective_date} className="num">
                        {c.effective_date}: {fmtBp(c.change_bp)} → {c.lower.toFixed(2)}–{c.upper.toFixed(2)}%
                      </li>
                    ))}
                  </ul>
                )}
                <Note>FRED records the date a new target took effect — often the business day after the FOMC statement.</Note>
              </>
            )}
          </div>
          <div className="xl:col-span-2">
            {det.error && <ErrorBox error={det.error} />}
            {!det.data && !det.error && <Loading />}
            {o && det.data && (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <Metric label="Policy change" tip={G.targetRange} value={fmtBp(o.policy_change_bp)} sub={`${o.policy_start.lower.toFixed(2)}–${o.policy_start.upper.toFixed(2)}% → ${o.policy_end.lower.toFixed(2)}–${o.policy_end.upper.toFixed(2)}%`} />
                  <Metric label="2Y change" tip={G.parYield} value={fmtBp(o.changes_bp["2Y"])} sub="observed" />
                  <Metric label="10Y change" tip={G.parYield} value={fmtBp(o.changes_bp["10Y"])} sub="observed" />
                  <Metric label="10Y–2Y spread" tip={G.s2s10} value={`${fmtBp(o.spread_2s10s_bp.start, 0)} → ${fmtBp(o.spread_2s10s_bp.end, 0)}`} sub={`${o.start_observed} → ${o.end_observed}`} />
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  <TenorCurveChart
                    height={220}
                    series={[{ key: "s", label: `Before ${o.start_observed}`, values: o.yields_start_pct }, { key: "e", label: `After ${o.end_observed}`, values: o.yields_end_pct }]}
                    caption="Actual Treasury par yields, percent (U.S. Treasury)."
                  />
                  <TenorBarChart height={220} series={[{ key: "c", label: "Observed change", values: o.changes_bp }]} fmt={(v) => v.toFixed(0)} yLabel="Change (bp)" caption="Observed par-yield change over the window, bp. Missing tenors shown blank." />
                </div>
                <TimeSeriesChart
                  rows={o.path}
                  height={190}
                  yLabel="Yield (%)"
                  series={[{ key: "3M", label: "3M" }, { key: "2Y", label: "2Y" }, { key: "10Y", label: "10Y" }, { key: "30Y", label: "30Y" }]}
                  refLines={ev.announcements.map((a) => ({ x: a.date, label: a.date.slice(5) }))}
                  caption="Daily par yields through the window; amber lines = announcement dates (shown if a trading day)."
                />
                <SourceLine prov={det.data.provenance} />
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Hypothetical: observed changes applied to today's portfolios"
          subtitle={ap.data ? `Valuation curve ${ap.data.hypothetical.valuation_curve_as_of}; settlement ${ap.data.hypothetical.settlement}; instantaneous shock = observed par-yield changes` : ""}
          right={ap.data && (
            <Button size="sm" onClick={() => downloadCsv(Object.entries(ap.data!.hypothetical.results).map(([k, v]) => ({ portfolio: k, market_value: v.market_value_before, duration: v.duration, dv01: v.dv01, pnl_full: v.pnl_full, return: v.return_full, pnl_krd_approx: v.pnl_krd_approx })), `historical_${id}.csv`)}>
              <Download className="h-3 w-3" /> CSV
            </Button>
          )}
        />
        <CardBody className="space-y-2">
          {ap.error && <ErrorBox error={ap.error} />}
          {!ap.data && !ap.error && <Loading />}
          {ap.data && (
            <>
              <Note tone="warn">{ap.data.hypothetical.disclaimer}</Note>
              {ap.data.assumptions.length > 0 && <Note tone="warn">Assumption used where data were unavailable: {ap.data.assumptions.join(" ")}</Note>}
              <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-2">
                <DataTable>
                  <thead><tr><Th>Portfolio</Th><Th right>MV</Th><Th right>Dmod</Th><Th right>P&L (full)</Th><Th right>Return</Th><Th right>KRD est.</Th></tr></thead>
                  <tbody>
                    {Object.entries(ap.data.hypothetical.results).map(([k, v]) => (
                      <tr key={k} className={cn("hover:bg-panel2/50", k.endsWith("(active)") && "bg-accent/10")}>
                        <Td>{k}</Td>
                        <Td right>{fmtUsd(v.market_value_before)}</Td>
                        <Td right>{fmtNum(v.duration, 2)}</Td>
                        <Td right className={pnlClass(v.pnl_full)}>{fmtUsd(v.pnl_full, { signed: true })}</Td>
                        <Td right className={pnlClass(v.return_full)}>{fmtSignedPct(v.return_full * 100)}</Td>
                        <Td right className="text-muted">{fmtUsd(v.pnl_krd_approx, { signed: true })}</Td>
                      </tr>
                    ))}
                  </tbody>
                </DataTable>
                <CategoryBarChart
                  rows={Object.entries(ap.data.hypothetical.results).map(([k, v]) => ({ name: k.replace(", duration-matched to bullet", ""), r: v.return_full * 100 }))}
                  series={[{ key: "r", label: "Hypothetical return (%)" }]}
                  fmt={(v) => `${v.toFixed(1)}%`}
                  xLabel="Return (%)"
                  signColors
                  height={240}
                />
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge>Shocks applied (bp):</Badge>
                {TENORS.map((t) => <Badge key={t}>{t} {fmtNum(ap.data!.hypothetical.shocks_bp[t], 0)}</Badge>)}
              </div>
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
