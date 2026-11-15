"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { useApi, TENORS, type PortfolioAnalytics, type Provenance } from "@/lib/api";
import { usePortfolios } from "@/lib/portfolio-store";
import { fmtBp, fmtNum, fmtPct, fmtSignedPct, fmtUsd, pnlClass, titleCase } from "@/lib/format";
import { G } from "@/lib/glossary";
import { Metric, SourceLine } from "@/components/common";
import { TenorCurveChart } from "@/components/charts";
import { Card, CardBody, CardHeader, DataTable, ErrorBox, Loading, Note, Td, Th, Badge, Button } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Overview = {
  curve: { as_of: string; par_pct: Record<string, number | null>; zero_pct: Record<string, number>; shape: { spread_2s10s_bp: number; spread_3m10y_bp: number; shape: string; shape_2s10s: string; shape_3m10y: string; definition: string }; warnings: string[] };
  comparisons: Record<string, { date: string; par_pct: Record<string, number | null>; change_bp: Record<string, number | null> }>;
  policy: { lower: number; upper: number; as_of: string };
  effr: { value: number; as_of: string };
  provenance: { treasury: Provenance; policy: Provenance; effr: Provenance };
};
type Stress = { rows: { key: string; label: string; pnl_full: number; return_full: number; pnl_krd_approx: number }[]; provenance: Provenance; curve_as_of: string };

const shapeTone = (s: string | null | undefined) => (s === "inverted" ? "neg" : s === "flat" ? "warn" : "live");

export default function OverviewPage() {
  const ov = useApi<Overview>("/api/market/overview");
  const { active } = usePortfolios();
  const body = active ? { positions: active.positions } : undefined;
  const pa = useApi<PortfolioAnalytics>(active ? "/api/portfolio/analyze" : null, body);
  const st = useApi<Stress>(active ? "/api/portfolio/stress" : null, body);
  const [cmp, setCmp] = useState<"1W" | "1M" | "3M" | "1Y">("1M");

  if (ov.error) return <ErrorBox error={ov.error} onRetry={ov.reload} />;
  if (!ov.data) return <Loading label="Loading market data" />;
  const d = ov.data;
  const c = d.curve;
  const prior = d.comparisons[cmp];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
        <Metric label="Fed target range" tip={G.targetRange} value={`${d.policy.lower.toFixed(2)}–${d.policy.upper.toFixed(2)}%`} sub={`FRED · as of ${d.policy.as_of}`} />
        <Metric label="Effective fed funds" tip={G.effr} value={fmtPct(d.effr.value)} sub={`FRED DFF · ${d.effr.as_of}`} />
        <Metric label="2Y Treasury" tip={G.parYield} value={fmtPct(c.par_pct["2Y"])} sub={<span>{fmtBp(prior.change_bp["2Y"])} vs {cmp}</span>} />
        <Metric label="10Y Treasury" tip={G.parYield} value={fmtPct(c.par_pct["10Y"])} sub={<span>{fmtBp(prior.change_bp["10Y"])} vs {cmp}</span>} />
        <Metric label="2Y–10Y spread" tip={G.s2s10} value={fmtBp(c.shape.spread_2s10s_bp, 0)} sub={titleCase(c.shape.shape_2s10s)} valueClass={c.shape.spread_2s10s_bp < 0 ? "text-warn" : ""} />
        <Metric label="3M–10Y spread" tip={G.s3m10} value={fmtBp(c.shape.spread_3m10y_bp, 0)} sub={titleCase(c.shape.shape_3m10y)} valueClass={c.shape.spread_3m10y_bp < 0 ? "text-warn" : ""} />
        <Metric label="Curve shape" tip={G.shape} value={<Badge tone={shapeTone(c.shape.shape)} className="text-xs">{titleCase(c.shape.shape)}</Badge>} sub={`Treasury as of ${c.as_of}`} />
      </div>

      <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-5">
        <Card className="xl:col-span-3">
          <CardHeader
            title="U.S. Treasury Par Yield Curve"
            tip={G.parYield}
            subtitle={`Latest observation ${c.as_of} vs ${prior.date} (${cmp} earlier). Bootstrapped zero curve shown dashed.`}
            right={(["1W", "1M", "3M", "1Y"] as const).map((k) => (
              <Button key={k} size="sm" variant={k === cmp ? "default" : "outline"} onClick={() => setCmp(k)}>
                {k}
              </Button>
            ))}
          />
          <CardBody>
            <TenorCurveChart
              height={290}
              series={[
                { key: "latest", label: `Par ${c.as_of}`, values: c.par_pct },
                { key: "prior", label: `Par ${prior.date}`, values: prior.par_pct },
                { key: "zero", label: `Zero (bootstrapped) ${c.as_of}`, values: c.zero_pct, dashed: true, color: "#199e70" },
              ]}
              caption="Units: percent, semiannual bond-equivalent. Source: U.S. Department of the Treasury, Daily Par Yield Curve Rates; zero rates computed by MONETARY (see Methodology)."
            />
            <SourceLine prov={d.provenance.treasury} />
          </CardBody>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Yields by maturity" subtitle={`Changes in bp vs 1W / 1M / 1Y earlier (last observation on or before each date)`} />
          <DataTable>
            <thead>
              <tr>
                <Th>Tenor</Th>
                <Th right>Par %</Th>
                <Th right>Zero %</Th>
                <Th right>Δ1W</Th>
                <Th right>Δ1M</Th>
                <Th right>Δ1Y</Th>
              </tr>
            </thead>
            <tbody>
              {TENORS.map((t) => (
                <tr key={t} className="hover:bg-panel2/50">
                  <Td className="font-medium">{t}</Td>
                  <Td right>{fmtNum(c.par_pct[t])}</Td>
                  <Td right className="text-muted">{fmtNum(c.zero_pct[t])}</Td>
                  {(["1W", "1M", "1Y"] as const).map((k) => (
                    <Td key={k} right>
                      {fmtBp(d.comparisons[k].change_bp[t])}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </DataTable>
          {c.warnings.length > 0 && <div className="p-2"><Note tone="warn">{c.warnings.join(" ")}</Note></div>}
        </Card>
      </div>

      <Card>
        <CardHeader
          title={`Active portfolio · ${active?.name ?? "—"}`}
          subtitle="Valued on the latest Treasury curve (bootstrapped zero curve, zero spread). Change the active portfolio in the header."
          right={
            <Link href="/portfolio" className="flex items-center gap-1 text-xs text-accent hover:underline">
              Full risk analytics <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <CardBody>
          {pa.error && <ErrorBox error={pa.error} onRetry={pa.reload} />}
          {!pa.data && !pa.error && <Loading />}
          {pa.data && (
            <div className="grid gap-3 [&>*]:min-w-0 lg:grid-cols-3">
              <div className="grid grid-cols-2 content-start gap-2">
                <Metric label="Market value" tip={G.marketValue} value={fmtUsd(pa.data.summary.market_value)} sub={`${pa.data.summary.positions} positions · face ${fmtUsd(pa.data.summary.face_amount)}`} />
                <Metric label="Modified duration" tip={G.modDur} value={`${fmtNum(pa.data.summary.modified_duration)}y`} sub={`Effective ${fmtNum(pa.data.summary.effective_duration)}y`} />
                <Metric label="DV01" tip={G.dv01} value={fmtUsd(pa.data.summary.dv01)} sub="per +1bp parallel" />
                <Metric label="Convexity" tip={G.convexity} value={fmtNum(pa.data.summary.convexity, 1)} sub={`Cash-flow yield ${fmtPct(pa.data.summary.cash_flow_yield_pct, 3)}`} />
              </div>
              <div className="min-w-0 lg:col-span-2">
                <div className="mb-1 flex items-center gap-1 text-2xs font-semibold uppercase tracking-wide text-muted">
                  Simulated instantaneous rate-scenario P&L (full revaluation)
                </div>
                {st.error && <ErrorBox error={st.error} />}
                {!st.data && !st.error && <Loading />}
                {st.data && (
                  <DataTable>
                    <thead>
                      <tr>
                        <Th>Scenario (hypothetical)</Th>
                        <Th right>P&L</Th>
                        <Th right>Return</Th>
                        <Th right>Duration-only est.</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {st.data.rows.map((r) => (
                        <tr key={r.key} className="hover:bg-panel2/50">
                          <Td>{r.label}</Td>
                          <Td right className={pnlClass(r.pnl_full)}>{fmtUsd(r.pnl_full, { signed: true })}</Td>
                          <Td right className={pnlClass(r.return_full)}>{fmtSignedPct(r.return_full * 100)}</Td>
                          <Td right className="text-muted">{fmtUsd(r.pnl_krd_approx, { signed: true })}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                )}
                <p className={cn("mt-1 text-[10px] text-muted")}>
                  Static positions, instantaneous shocks to par yields; shape scenarios defined on the Yield Curve page. Not a forecast.
                </p>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
