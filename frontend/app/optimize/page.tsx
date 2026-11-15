"use client";
import { useMemo, useState } from "react";
import { Download, Save } from "lucide-react";
import { useApi, TENORS, type Position, type Provenance } from "@/lib/api";
import { usePortfolios } from "@/lib/portfolio-store";
import { downloadCsv } from "@/lib/csv";
import { fmtNum, fmtPct, fmtSignedPct, fmtUsd, pnlClass } from "@/lib/format";
import { G } from "@/lib/glossary";
import { Bullets, Metric, PageIntro, SourceLine } from "@/components/common";
import { CategoryBarChart, TenorBarChart } from "@/components/charts";
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, ErrorBox, Field, Input, Loading, Note, Select, Slider, Switch, Td, Th,
} from "@/components/ui/primitives";

type OptResp = {
  objective: string;
  status: "optimal" | "infeasible" | "solver_failed";
  constraints: string[];
  inputs: Record<string, unknown>;
  solver?: { method: string; success: boolean; message: string; iterations: number; objective_value: number };
  solver_message?: string;
  hint?: string;
  objective_formula?: string;
  constraint_residuals?: { equality: number[]; inequality_slack_violation: number[] };
  allocations?: { label: string; weight: number; market_value: number; face_amount: number; modified_duration: number; ytm_pct: number }[];
  portfolio?: { modified_duration: number; convexity: number; mv_weighted_ytm_pct: number; hhi: number; krd: Record<string, number>; target_krd: Record<string, number> | null };
  positions?: { id: string; label: string; coupon_pct: number; maturity: string; face_amount: number }[];
  assumptions?: string[];
  curve_as_of: string;
  provenance: Provenance;
};

const OBJECTIVES = [
  { value: "min_concentration", label: "Target duration, minimize concentration", desc: "Hit a duration target while spreading weight as evenly as the constraints allow (min Σw²)." },
  { value: "match_krd", label: "Match a benchmark's key-rate exposures", desc: "Replicate a benchmark portfolio's key-rate duration profile with the candidate bonds (least squares)." },
  { value: "risk_target", label: "Minimize weighted deviation from a KRD target", desc: "You specify target key-rate durations and importance weights by tenor." },
  { value: "max_yield", label: "Maximize yield subject to constraints (NOT expected return)", desc: "Maximizes MV-weighted YTM. Yield is not expected return: it ignores curve changes, roll-down and reinvestment risk." },
];
const UNIVERSE = [1, 2, 3, 5, 7, 10, 20, 30];

export default function OptimizePage() {
  const { portfolios, active, saveAs, setActiveId } = usePortfolios();
  const [objective, setObjective] = useState("min_concentration");
  const [capital, setCapital] = useState(100_000_000);
  const [dur, setDur] = useState(6);
  const [useDur, setUseDur] = useState(true);
  const [maxW, setMaxW] = useState(0.4);
  const [bucketCap, setBucketCap] = useState(false);
  const [maxBucket, setMaxBucket] = useState(0.5);
  const [longOnly, setLongOnly] = useState(true);
  const [universe, setUniverse] = useState<number[]>(UNIVERSE);
  const [useHoldings, setUseHoldings] = useState(false);
  const [bench, setBench] = useState("sample:ladder");
  const [target, setTarget] = useState<Record<string, number>>({ "2Y": 0.5, "5Y": 1.5, "10Y": 2.5, "30Y": 1.0 });
  const [wts, setWts] = useState<Record<string, number>>({});
  const [saved, setSaved] = useState<string | null>(null);

  const benchmark = portfolios.find((p) => p.id === bench);
  const body = useMemo(() => {
    const needsDur = objective === "min_concentration" || useDur;
    return {
      objective,
      capital,
      target_duration: needsDur ? dur : null,
      max_weight: maxW,
      max_bucket_weight: bucketCap ? maxBucket : null,
      long_only: longOnly,
      universe_years: useHoldings ? null : universe,
      universe_positions: useHoldings ? active?.positions : null,
      benchmark_positions: objective === "match_krd" ? benchmark?.positions : null,
      target_krd: objective === "risk_target" ? Object.fromEntries(TENORS.map((t) => [t, target[t] ?? 0])) : null,
      krd_weights: objective === "risk_target" ? Object.fromEntries(TENORS.map((t) => [t, wts[t] ?? 1])) : null,
    };
  }, [objective, capital, dur, useDur, maxW, bucketCap, maxBucket, longOnly, universe, useHoldings, active, benchmark, target, wts]);
  const ok = universe.length >= 2 || useHoldings;
  const r = useApi<OptResp>(ok ? "/api/optimize" : null, body, 300);
  const d = r.data;

  return (
    <div className="space-y-3">
      <PageIntro>
        Risk-targeting optimization with SciPy (SLSQP), with a HiGHS linear-programming feasibility pre-check. Every run discloses the
        objective function, constraints, inputs, solver status and residuals. No objective here maximizes expected return — that would
        require an expected-return model, which MONETARY deliberately does not invent.
      </PageIntro>
      <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-[400px_1fr]">
        <Card>
          <CardHeader title="Problem specification" />
          <CardBody className="space-y-3">
            <Field label="Objective">
              <Select value={objective} onChange={setObjective} options={OBJECTIVES.map((o) => ({ value: o.value, label: o.label }))} />
            </Field>
            <Note tone={objective === "max_yield" ? "warn" : "neutral"}>{OBJECTIVES.find((o) => o.value === objective)?.desc}</Note>
            <Field label="Available capital ($)">
              <Input type="number" step={1_000_000} min={1} value={capital} onChange={(e) => setCapital(Math.max(1, Number(e.target.value)))} />
            </Field>
            {objective !== "min_concentration" && <Switch checked={useDur} onChange={setUseDur} label="Also impose a duration target" />}
            {(objective === "min_concentration" || useDur) && (
              <Field label={`Portfolio modified duration target: ${dur.toFixed(2)} years`} tip={G.modDur}>
                <Slider value={dur} min={0.5} max={20} step={0.25} onChange={setDur} ariaLabel="Duration target" />
              </Field>
            )}
            <Field label={`Max weight per security: ${(maxW * 100).toFixed(0)}%`}>
              <Slider value={maxW} min={0.05} max={1} step={0.05} onChange={setMaxW} ariaLabel="Maximum weight" />
            </Field>
            <Switch checked={bucketCap} onChange={setBucketCap} label="Cap allocation per maturity bucket" />
            {bucketCap && (
              <Field label={`Max per maturity bucket: ${(maxBucket * 100).toFixed(0)}%`}>
                <Slider value={maxBucket} min={0.1} max={1} step={0.05} onChange={setMaxBucket} ariaLabel="Maximum bucket weight" />
              </Field>
            )}
            <Switch checked={longOnly} onChange={setLongOnly} label="Long-only (no short positions)" />
            <div>
              <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted">Candidate universe</div>
              <Switch checked={useHoldings} onChange={setUseHoldings} label={`Use active portfolio holdings (${active?.name ?? "—"})`} />
              {!useHoldings && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {UNIVERSE.map((y) => (
                    <button
                      key={y}
                      aria-pressed={universe.includes(y)}
                      onClick={() => setUniverse((u) => (u.includes(y) ? u.filter((x) => x !== y) : [...u, y].sort((a, b) => a - b)))}
                      className={`rounded border px-1.5 py-0.5 text-2xs ${universe.includes(y) ? "border-accent bg-accent/15" : "border-border text-muted"}`}
                    >
                      {y}Y par bond
                    </button>
                  ))}
                </div>
              )}
            </div>
            {objective === "match_krd" && (
              <Field label="Benchmark portfolio">
                <Select value={bench} onChange={setBench} options={portfolios.map((p) => ({ value: p.id, label: p.name }))} />
              </Field>
            )}
            {objective === "risk_target" && (
              <div>
                <div className="mb-1 text-2xs uppercase tracking-wide text-muted">Target KRD (years) / importance weight ω by tenor</div>
                <div className="grid grid-cols-4 gap-1">
                  {TENORS.map((t) => (
                    <div key={t} className="flex flex-col gap-0.5">
                      <span className="text-[10px] text-muted">{t}</span>
                      <Input aria-label={`Target KRD ${t}`} type="number" step={0.1} value={target[t] ?? 0} onChange={(e) => setTarget((x) => ({ ...x, [t]: Number(e.target.value) || 0 }))} />
                      <Input aria-label={`Weight ${t}`} type="number" step={0.5} min={0} value={wts[t] ?? 1} onChange={(e) => setWts((x) => ({ ...x, [t]: Math.max(0, Number(e.target.value) || 0) }))} className="text-muted" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="min-w-0 space-y-3">
          {!ok && <Note tone="warn">Select at least two candidate maturities.</Note>}
          {r.error && <ErrorBox error={r.error} />}
          {ok && !d && !r.error && <Loading label="Solving" />}
          {d && (
            <>
              <Card>
                <CardHeader
                  title="Solver report"
                  right={<Badge tone={d.status === "optimal" ? "live" : "neg"}>{d.status}</Badge>}
                  subtitle={`Curve ${d.curve_as_of}`}
                />
                <CardBody className="space-y-2 text-xs">
                  {d.status === "infeasible" && <ErrorBox error={`${d.solver_message} ${d.hint ?? ""}`} />}
                  {d.objective_formula && <div><span className="text-muted">Objective: </span><code className="num">{d.objective_formula}</code></div>}
                  <div>
                    <span className="text-muted">Constraints:</span>
                    <Bullets items={d.constraints} />
                  </div>
                  {d.solver && (
                    <div className="num text-muted">
                      {d.solver.method} · success={String(d.solver.success)} · {d.solver.message} · iterations {d.solver.iterations} · objective {d.solver.objective_value.toExponential(4)}
                      {d.constraint_residuals && ` · max |equality residual| ${Math.max(...d.constraint_residuals.equality.map(Math.abs)).toExponential(1)}`}
                    </div>
                  )}
                  <SourceLine prov={d.provenance} />
                </CardBody>
              </Card>
              {d.portfolio && d.allocations && (
                <>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <Metric label="Modified duration" tip={G.modDur} value={`${fmtNum(d.portfolio.modified_duration, 3)}y`} />
                    <Metric label="Convexity" tip={G.convexity} value={fmtNum(d.portfolio.convexity, 2)} />
                    <Metric label="MV-wtd YTM" tip={G.mvYtm} value={fmtPct(d.portfolio.mv_weighted_ytm_pct, 3)} sub="yield ≠ expected return" />
                    <Metric label="HHI" tip={G.hhi} value={fmtNum(d.portfolio.hhi, 3)} sub={`${fmtNum(1 / d.portfolio.hhi, 1)} effective positions`} />
                  </div>
                  <div className="grid gap-3 [&>*]:min-w-0 2xl:grid-cols-2">
                    <Card>
                      <CardHeader
                        title="Optimal allocation"
                        right={
                          <>
                            <Button size="sm" onClick={() => downloadCsv(d.allocations!, "optimal_allocation.csv")}><Download className="h-3 w-3" /> CSV</Button>
                            <Button
                              size="sm"
                              variant="default"
                              disabled={!d.positions?.length}
                              onClick={() => {
                                const pos: Position[] = d.positions!.map((p) => ({ ...p, frequency: 2, day_count: "ACT/ACT-ICMA" }));
                                const id = saveAs(`Optimized ${new Date().toISOString().slice(0, 16).replace("T", " ")}`, pos);
                                setActiveId(id);
                                setSaved(id);
                              }}
                            >
                              <Save className="h-3 w-3" /> Save as portfolio
                            </Button>
                          </>
                        }
                      />
                      {saved && <div className="px-3 pt-2 text-2xs text-pos">Saved and set as the active portfolio — analyze it under Portfolio Risk Analytics.</div>}
                      <DataTable>
                        <thead><tr><Th>Security</Th><Th right>Weight</Th><Th right>Market value</Th><Th right>Face</Th><Th right>Dmod</Th><Th right>YTM</Th></tr></thead>
                        <tbody>
                          {d.allocations.map((a) => (
                            <tr key={a.label} className={a.weight === 0 ? "text-muted" : ""}>
                              <Td>{a.label}</Td>
                              <Td right className={a.weight < 0 ? "text-neg" : ""}>{fmtPct(a.weight * 100, 2)}</Td>
                              <Td right>{fmtUsd(a.market_value)}</Td>
                              <Td right>{fmtUsd(a.face_amount)}</Td>
                              <Td right>{fmtNum(a.modified_duration, 2)}</Td>
                              <Td right>{fmtNum(a.ytm_pct, 3)}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </DataTable>
                      <CardBody>
                        <CategoryBarChart rows={d.allocations.map((a) => ({ name: a.label.replace(/^UST /, ""), w: a.weight * 100 }))} series={[{ key: "w", label: "Weight (%)" }]} fmt={(v) => `${v.toFixed(0)}%`} xLabel="Weight (%)" height={220} />
                      </CardBody>
                    </Card>
                    <Card>
                      <CardHeader title="Key-rate profile" tip={G.krd} />
                      <CardBody>
                        <TenorBarChart
                          height={260}
                          series={[{ key: "p", label: "Optimized", values: d.portfolio.krd }, ...(d.portfolio.target_krd ? [{ key: "t", label: "Target / benchmark", values: d.portfolio.target_krd }] : [])]}
                          fmt={(v) => v.toFixed(2)}
                          yLabel="KRD (years)"
                          caption="Market-value-weighted key-rate durations, years."
                        />
                        <Bullets className="mt-2 text-muted" items={d.assumptions ?? []} />
                      </CardBody>
                    </Card>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
      <BarbellBullet />
    </div>
  );
}

type BB = {
  bullet: { summary: { modified_duration: number; convexity: number; cash_flow_yield_pct: number; dv01: number; market_value: number }; krd: Record<string, number>; positions: { label: string; face_amount: number }[] };
  barbell: { summary: { modified_duration: number; convexity: number; cash_flow_yield_pct: number; dv01: number; market_value: number }; krd: Record<string, number>; positions: { label: string; face_amount: number }[] };
  weights: { short: number; long: number };
  scenarios: Record<string, { label: string; bullet: number; barbell: number; barbell_minus_bullet_bp: number }>;
  method: string;
  curve_as_of: string;
};

function BarbellBullet() {
  const [t, setT] = useState(10);
  const [sw, setSw] = useState(2);
  const [lw, setLw] = useState(30);
  const r = useApi<BB>("/api/optimize/barbell-bullet", { target_years: t, short_years: sw, long_years: lw }, 250);
  const d = r.data;
  return (
    <Card>
      <CardHeader title="Barbell vs bullet" subtitle="Duration-matched comparison: same market value and modified duration, different curve exposure and convexity." />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap gap-3">
          <Field label="Bullet maturity (y)"><Select value={String(t)} onChange={(v) => setT(Number(v))} options={[3, 5, 7, 10, 15, 20].map((y) => ({ value: String(y), label: `${y}Y` }))} /></Field>
          <Field label="Short wing (y)"><Select value={String(sw)} onChange={(v) => setSw(Number(v))} options={[1, 2, 3, 5].map((y) => ({ value: String(y), label: `${y}Y` }))} /></Field>
          <Field label="Long wing (y)"><Select value={String(lw)} onChange={(v) => setLw(Number(v))} options={[10, 20, 30].map((y) => ({ value: String(y), label: `${y}Y` }))} /></Field>
        </div>
        {r.error && <ErrorBox error={r.error} />}
        {!d && !r.error && <Loading />}
        {d && (
          <div className="grid gap-3 [&>*]:min-w-0 lg:grid-cols-2">
            <div className="space-y-2">
              <DataTable>
                <thead><tr><Th>Metric</Th><Th right>Bullet</Th><Th right>Barbell</Th></tr></thead>
                <tbody>
                  <tr><Td>Holdings</Td><Td right>{d.bullet.positions.map((p) => p.label.replace(/^UST /, "")).join(", ")}</Td><Td right>{(d.weights.short * 100).toFixed(1)}% / {(d.weights.long * 100).toFixed(1)}%</Td></tr>
                  <tr><Td>Modified duration</Td><Td right>{fmtNum(d.bullet.summary.modified_duration, 3)}</Td><Td right>{fmtNum(d.barbell.summary.modified_duration, 3)}</Td></tr>
                  <tr><Td>Convexity</Td><Td right>{fmtNum(d.bullet.summary.convexity, 1)}</Td><Td right className="text-pos">{fmtNum(d.barbell.summary.convexity, 1)}</Td></tr>
                  <tr><Td>Cash-flow yield</Td><Td right>{fmtPct(d.bullet.summary.cash_flow_yield_pct, 3)}</Td><Td right>{fmtPct(d.barbell.summary.cash_flow_yield_pct, 3)}</Td></tr>
                  <tr><Td>DV01</Td><Td right>{fmtUsd(d.bullet.summary.dv01)}</Td><Td right>{fmtUsd(d.barbell.summary.dv01)}</Td></tr>
                </tbody>
              </DataTable>
              <Note>
                {d.method} Yield difference (barbell − bullet): {((d.barbell.summary.cash_flow_yield_pct - d.bullet.summary.cash_flow_yield_pct) * 100).toFixed(1)} bp;
                convexity difference: {(d.barbell.summary.convexity - d.bullet.summary.convexity).toFixed(1)}. On a curve that is not flat, extra convexity is
                typically paid for with lower yield; which structure does better depends on how the curve moves.
              </Note>
            </div>
            <TenorBarChart height={250} series={[{ key: "a", label: "Bullet", values: d.bullet.krd }, { key: "b", label: "Barbell", values: d.barbell.krd }]} fmt={(v) => v.toFixed(2)} yLabel="KRD (years)" caption={`Curve ${d.curve_as_of}. Same total duration, opposite exposure to the belly vs the wings.`} />
            <div className="lg:col-span-2"><DataTable>
              <thead><tr><Th>Scenario (instantaneous)</Th><Th right>Bullet</Th><Th right>Barbell</Th><Th right>Diff (bp)</Th></tr></thead>
              <tbody>
                {Object.entries(d.scenarios).map(([k, v]) => (
                  <tr key={k}>
                    <Td>{v.label}</Td>
                    <Td right className={pnlClass(v.bullet)}>{fmtSignedPct(v.bullet * 100)}</Td>
                    <Td right className={pnlClass(v.barbell)}>{fmtSignedPct(v.barbell * 100)}</Td>
                    <Td right className={pnlClass(v.barbell_minus_bullet_bp)}>{v.barbell_minus_bullet_bp > 0 ? "+" : ""}{v.barbell_minus_bullet_bp.toFixed(0)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable></div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
