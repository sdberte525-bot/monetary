"use client";
import { useMemo, useState } from "react";
import { Download, FileDown, RotateCcw, Save } from "lucide-react";
import { apiDownload, useApi, TENORS, type Provenance, type ScenarioResult } from "@/lib/api";
import { usePortfolios, useSavedList } from "@/lib/portfolio-store";
import { downloadCsv } from "@/lib/csv";
import { fmtBp, fmtNum, fmtPct, fmtSignedPct, fmtUsd, pnlClass } from "@/lib/format";
import { G } from "@/lib/glossary";
import { Bullets, Metric, PageIntro, SourceLine } from "@/components/common";
import { DecompositionChart, TenorBarChart, TenorCurveChart, WaterfallChart } from "@/components/charts";
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, ErrorBox, Field, Input, Loading, Note, Select, Slider, Td, Th,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Interp = { label: string; priced_in: number; path_bp: number; term_premium_bp: number; note: string };
type Config = {
  policy_presets_bp: Record<string, number>;
  interpretations: Record<string, Interp>;
  transmission_profiles: Record<string, { label: string; beta: Record<string, number> }>;
  loadings: { pass_through_default: Record<string, number>; path: Record<string, number>; term_premium: Record<string, number> };
  current_policy: { lower: number; upper: number; as_of: string };
  disclaimer: string;
};
type SimResult = {
  translation: {
    policy_move_bp: number; expected_component_bp: number; surprise_bp: number; shocks_bp: Record<string, number>;
    components: { tenor: string; surprise: number; path: number; term_premium: number; overlay: number; total: number }[];
    formula: string; disclaimer: string; loadings: { pass_through: Record<string, number> };
  };
  assumptions: string[];
  policy_before: { lower: number; upper: number; as_of: string };
  policy_after: { lower: number; upper: number; note: string };
  scenario: ScenarioResult;
  classification: string;
  provenance: Provenance;
  curve_as_of: string;
};

type Params = {
  move: number;
  interpretation: string;
  priced_in: number;
  path_bp: number;
  term_premium_bp: number;
  transmission: string;
  beta: Record<string, number> | null; // overrides (custom)
  overlay_kind: string;
  overlay_bp: number;
  overlay_pivot: string;
};

const MOVES: [string, number][] = [["−100", -100], ["−50", -50], ["−25", -25], ["Hold", 0], ["+25", 25], ["+50", 50], ["+100", 100]];
const DEFAULT: Params = {
  move: -25, interpretation: "dovish_surprise", priced_in: 0, path_bp: -15, term_premium_bp: -3, transmission: "front_end",
  beta: null, overlay_kind: "none", overlay_bp: 0, overlay_pivot: "5Y",
};

export default function PolicyPage() {
  const cfg = useApi<Config>("/api/policy/config");
  const { active } = usePortfolios();
  const [p, setP] = useState<Params>(DEFAULT);
  const [customMove, setCustomMove] = useState(false);
  const saved = useSavedList<{ name: string; params: Params }>("monetary.policy.v1");
  const [saveName, setSaveName] = useState("");
  const [pdfErr, setPdfErr] = useState<string | null>(null);

  const set = <K extends keyof Params>(k: K, v: Params[K]) => setP((s) => ({ ...s, [k]: v }));
  const applyInterp = (key: string) => {
    const it = cfg.data?.interpretations[key];
    if (!it) return;
    setP((s) => ({ ...s, interpretation: key, priced_in: it.priced_in, path_bp: it.path_bp, term_premium_bp: it.term_premium_bp }));
  };

  const policyParams = useMemo(
    () => ({
      policy_move_bp: p.move,
      interpretation: p.interpretation,
      priced_in: p.priced_in,
      path_bp: p.path_bp,
      term_premium_bp: p.term_premium_bp,
      transmission: p.transmission,
      pass_through: p.beta ?? undefined,
      overlay_kind: p.overlay_kind,
      overlay_bp: p.overlay_bp,
      overlay_pivot: p.overlay_pivot,
    }),
    [p],
  );
  const body = active ? { ...policyParams, positions: active.positions } : undefined;
  const sim = useApi<SimResult>(active && cfg.data ? "/api/policy/simulate" : null, body, 180);

  const beta = p.beta ?? cfg.data?.transmission_profiles[p.transmission]?.beta ?? {};

  if (cfg.error) return <ErrorBox error={cfg.error} onRetry={cfg.reload} />;
  if (!cfg.data) return <Loading label="Loading simulator" />;
  const c = cfg.data;
  const r = sim.data;
  const sc = r?.scenario;

  return (
    <div className="space-y-3">
      <PageIntro>
        Translate a <b>hypothetical</b> Federal Reserve decision into a Treasury curve shock and reprice the active portfolio. A change in
        the fed funds target does <b>not</b> mechanically move every Treasury yield by the same amount: anticipated moves are already priced,
        and longer yields depend on the expected policy path and term premia. Every channel below is an explicit, editable assumption —
        presets are illustrative, not empirical forecasts, and nothing here predicts actual FOMC decisions or yields.
      </PageIntro>

      <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-[380px_1fr]">
        {/* ------------------------------------------------------------ controls */}
        <div className="space-y-3 xl:sticky xl:top-14 xl:max-h-[calc(100vh-4rem)] xl:overflow-y-auto">
          <Card>
            <CardHeader
              title="1 · Policy decision"
              tip="Hypothetical change in the FOMC target range (both bounds move together)."
              subtitle={`Current range ${c.current_policy.lower.toFixed(2)}–${c.current_policy.upper.toFixed(2)}% (FRED, ${c.current_policy.as_of})`}
            />
            <CardBody className="space-y-2">
              <div className="grid grid-cols-4 gap-1">
                {MOVES.map(([lab, v]) => (
                  <Button key={lab} size="sm" variant={!customMove && p.move === v ? "default" : "outline"} onClick={() => { setCustomMove(false); set("move", v); }}>
                    {lab}
                  </Button>
                ))}
                <Button size="sm" variant={customMove ? "default" : "outline"} onClick={() => setCustomMove(true)}>
                  Custom
                </Button>
              </div>
              {customMove && (
                <Field label={`Custom move: ${p.move > 0 ? "+" : ""}${p.move} bp`}>
                  <Slider value={p.move} min={-300} max={300} step={5} onChange={(v) => set("move", v)} ariaLabel="Custom policy move" />
                </Field>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="2 · Market interpretation" tip={G.surprise} />
            <CardBody className="space-y-2.5">
              <Select
                ariaLabel="Market interpretation"
                value={p.interpretation}
                onChange={applyInterp}
                className="w-full"
                options={Object.entries(c.interpretations).map(([k, v]) => ({ value: k, label: v.label }))}
              />
              <Note>{c.interpretations[p.interpretation]?.note}</Note>
              <Field label={`Share of move already priced in: ${(p.priced_in * 100).toFixed(0)}%`} tip={G.surprise}>
                <Slider value={p.priced_in} min={0} max={1} step={0.05} onChange={(v) => set("priced_in", v)} ariaLabel="Share priced in" />
              </Field>
              <Field label={`Expected-path revision: ${p.path_bp > 0 ? "+" : ""}${p.path_bp} bp`} tip={G.pathRevision}>
                <Slider value={p.path_bp} min={-150} max={150} step={5} onChange={(v) => set("path_bp", v)} ariaLabel="Path revision" />
              </Field>
              <Field label={`Term-premium shift: ${p.term_premium_bp > 0 ? "+" : ""}${p.term_premium_bp} bp`} tip={G.termPremium}>
                <Slider value={p.term_premium_bp} min={-100} max={100} step={5} onChange={(v) => set("term_premium_bp", v)} ariaLabel="Term premium shift" />
              </Field>
              <Button size="sm" variant="ghost" onClick={() => applyInterp(p.interpretation)}>
                <RotateCcw className="h-3 w-3" /> Reset to preset values
              </Button>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="3 · Yield-curve transmission" tip={G.passThrough} />
            <CardBody className="space-y-2.5">
              <Select
                ariaLabel="Transmission profile"
                value={p.beta ? "custom" : p.transmission}
                onChange={(v) => setP((s) => ({ ...s, transmission: v, beta: v === "custom" ? { ...c.loadings.pass_through_default } : null }))}
                className="w-full"
                options={Object.entries(c.transmission_profiles).map(([k, v]) => ({ value: k, label: v.label }))}
              />
              <div>
                <div className="mb-1 text-2xs uppercase tracking-wide text-muted">Pass-through (beta) by tenor, bp per bp of surprise — edit to customize</div>
                <div className="grid grid-cols-6 gap-1">
                  {TENORS.map((t) => (
                    <label key={t} className="flex flex-col items-center">
                      <span className="text-[10px] text-muted">{t}</span>
                      <Input
                        type="number"
                        step={0.05}
                        min={-2}
                        max={2}
                        aria-label={`Pass-through ${t}`}
                        className="px-1 text-center"
                        value={beta[t] ?? 0}
                        onChange={(e) => {
                          const v = Math.max(-2, Math.min(2, Number(e.target.value) || 0));
                          setP((s) => ({ ...s, transmission: "custom", beta: { ...(s.beta ?? beta), [t]: v } }));
                        }}
                      />
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Curve overlay">
                  <Select
                    value={p.overlay_kind}
                    onChange={(v) => set("overlay_kind", v)}
                    options={[
                      { value: "none", label: "None" },
                      { value: "parallel", label: "Parallel shift" },
                      { value: "steepening", label: "Steepening (vs 2Y)" },
                      { value: "flattening", label: "Flattening (vs 2Y)" },
                      { value: "twist", label: "Twist around pivot" },
                    ]}
                  />
                </Field>
                {p.overlay_kind === "twist" && (
                  <Field label="Pivot">
                    <Select value={p.overlay_pivot} onChange={(v) => set("overlay_pivot", v)} options={["3Y", "5Y", "7Y", "10Y"].map((t) => ({ value: t, label: t }))} />
                  </Field>
                )}
              </div>
              {p.overlay_kind !== "none" && (
                <Field label={`Overlay magnitude: ${p.overlay_bp > 0 ? "+" : ""}${p.overlay_bp} bp`}>
                  <Slider value={p.overlay_bp} min={-100} max={100} step={5} onChange={(v) => set("overlay_bp", v)} ariaLabel="Overlay magnitude" />
                </Field>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardBody className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => { setP(DEFAULT); setCustomMove(false); }}>
                <RotateCcw className="h-3 w-3" /> Reset scenario
              </Button>
              <Input placeholder="Scenario name" value={saveName} onChange={(e) => setSaveName(e.target.value)} className="w-32 font-sans" />
              <Button size="sm" disabled={!saveName.trim()} onClick={() => { saved.save({ name: saveName.trim(), params: p }); setSaveName(""); }}>
                <Save className="h-3 w-3" /> Save
              </Button>
              {saved.items.length > 0 && (
                <Select
                  ariaLabel="Load saved policy scenario"
                  value=""
                  onChange={(n) => {
                    const s = saved.items.find((i) => i.name === n);
                    if (s) {
                      setP(s.params);
                      setCustomMove(!MOVES.some(([, v]) => v === s.params.move));
                    }
                  }}
                  options={[{ value: "", label: "Load saved…" }, ...saved.items.map((i) => ({ value: i.name, label: i.name }))]}
                />
              )}
            </CardBody>
          </Card>
        </div>

        {/* ------------------------------------------------------------ outputs */}
        <div className="min-w-0 space-y-3">
          {!active && <Loading label="Loading portfolio" />}
          {sim.error && <ErrorBox error={sim.error} onRetry={sim.reload} />}
          {!r && !sim.error && active && <Loading label="Repricing portfolio" />}
          {r && sc && (
            <div className={cn("space-y-3 transition-opacity", sim.loading && "opacity-70")}>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3 2xl:grid-cols-6">
                <Metric
                  label="Target range"
                  tip={G.targetRange}
                  value={`${r.policy_after.lower.toFixed(2)}–${r.policy_after.upper.toFixed(2)}%`}
                  sub={`from ${r.policy_before.lower.toFixed(2)}–${r.policy_before.upper.toFixed(2)}% (hypothetical)`}
                />
                <Metric label="Policy surprise" tip={G.surprise} value={fmtBp(r.translation.surprise_bp, 0)} sub={`${fmtBp(r.translation.expected_component_bp, 0, false)} assumed priced in`} />
                <Metric
                  label="2Y / 10Y change"
                  tip="Scenario change in the 2-year and 10-year par yields. Compare with the policy move: transmission is not one-for-one."
                  value={`${fmtBp(sc.shocks_bp["2Y"], 0)} / ${fmtBp(sc.shocks_bp["10Y"], 0)}`}
                  sub={r.translation.policy_move_bp !== 0 ? `10Y moves ${(Math.abs(sc.shocks_bp["10Y"] / r.translation.policy_move_bp)).toFixed(2)}× policy` : "Policy unchanged"}
                />
                <Metric label="Curve move" tip={G.s2s10} value={<span className="text-sm">{r.classification}</span>} sub={`10Y–2Y ${fmtBp(sc.curve_shape_before.spread_2s10s_bp, 0)} → ${fmtBp(sc.curve_shape_after.spread_2s10s_bp, 0)}`} />
                <Metric label="Portfolio P&L" tip={G.pnlFull} value={fmtUsd(sc.totals.pnl_full, { signed: true })} valueClass={pnlClass(sc.totals.pnl_full)} sub={active?.name} />
                <Metric label="Return" tip={G.pnlFull} value={fmtSignedPct(sc.totals.return_full * 100)} valueClass={pnlClass(sc.totals.return_full)} sub="instantaneous, full revaluation" />
              </div>

              <div className="grid gap-3 [&>*]:min-w-0 2xl:grid-cols-2">
                <Card>
                  <CardHeader title="Treasury curve: before vs after" tip={G.parYield} subtitle={`Base curve ${r.curve_as_of} (official data) vs hypothetical shocked curve`} />
                  <CardBody>
                    <TenorCurveChart
                      height={250}
                      series={[
                        { key: "before", label: `Before (${r.curve_as_of})`, values: sc.base_curve_pct },
                        { key: "after", label: "After (hypothetical)", values: sc.shocked_curve_pct },
                      ]}
                      caption="Par yields, percent (semiannual bond-equivalent). Base: U.S. Treasury. Shock: user assumptions."
                    />
                    <SourceLine prov={r.provenance} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Yield-shock decomposition" subtitle={r.translation.formula} />
                  <CardBody>
                    <DecompositionChart
                      height={250}
                      rows={r.translation.components.map((x) => ({ ...x }))}
                      components={[
                        { key: "surprise", label: "Policy surprise × β" },
                        { key: "path", label: "Path revision" },
                        { key: "term_premium", label: "Term premium" },
                        { key: "overlay", label: "Overlay" },
                      ]}
                      caption="Basis points by tenor. Components are additive; the white line is the total shock applied to par yields."
                    />
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader title="Plain-English interpretation" subtitle="Generated from the computed outputs above — every number is calculated, no text is free-form." />
                <CardBody className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted">What the scenario implies</div>
                    <Bullets items={sc.commentary ?? []} />
                  </div>
                  <div>
                    <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted">Risk observations (analytical, not recommendations)</div>
                    <Bullets items={sc.risk_observations ?? []} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        onClick={async () => {
                          setPdfErr(null);
                          try {
                            await apiDownload("/api/report/pdf", { positions: active!.positions, portfolio_name: active!.name, policy: policyParams }, "monetary_policy_scenario_brief.pdf");
                          } catch (e) {
                            setPdfErr((e as Error).message);
                          }
                        }}
                      >
                        <FileDown className="h-3 w-3" /> Export PDF brief
                      </Button>
                      <Button
                        size="sm"
                        onClick={() =>
                          downloadCsv(
                            sc.pnl.map((x) => ({ security: x.label, mv_before: x.market_value_before, mv_after: x.market_value_after, pnl_full: x.pnl_full, return: x.return_full, pnl_krd_approx: x.pnl_krd_approx, ytm_change_bp: x.ytm_change_bp })),
                            "policy_scenario_pnl.csv",
                          )
                        }
                      >
                        <Download className="h-3 w-3" /> P&L CSV
                      </Button>
                    </div>
                    {pdfErr && <ErrorBox error={pdfErr} />}
                  </div>
                </CardBody>
              </Card>

              <div className="grid gap-3 [&>*]:min-w-0 2xl:grid-cols-2">
                <Card>
                  <CardHeader title="Portfolio before / after" subtitle="Static positions; full cash-flow revaluation on the re-bootstrapped curve." />
                  <DataTable>
                    <thead>
                      <tr><Th>Metric</Th><Th right>Before</Th><Th right>After</Th><Th right>Change</Th></tr>
                    </thead>
                    <tbody>
                      {[
                        ["Market value", G.marketValue, sc.base.summary.market_value, sc.shocked.summary.market_value, (v: number) => fmtUsd(v, { compact: false })],
                        ["Modified duration (y)", G.modDur, sc.base.summary.modified_duration, sc.shocked.summary.modified_duration, (v: number) => fmtNum(v, 3)],
                        ["Effective duration (y)", G.effDur, sc.base.summary.effective_duration, sc.shocked.summary.effective_duration, (v: number) => fmtNum(v, 3)],
                        ["Convexity", G.convexity, sc.base.summary.convexity, sc.shocked.summary.convexity, (v: number) => fmtNum(v, 2)],
                        ["DV01 ($/bp)", G.dv01, sc.base.summary.dv01, sc.shocked.summary.dv01, (v: number) => fmtUsd(v, { compact: false })],
                        ["Cash-flow yield (%)", G.cashFlowYield, sc.base.summary.cash_flow_yield_pct, sc.shocked.summary.cash_flow_yield_pct, (v: number) => fmtNum(v, 3)],
                      ].map(([lab, , a, b, f]) => {
                        const fm = f as (v: number) => string;
                        return (
                          <tr key={lab as string} className="hover:bg-panel2/50">
                            <Td>{lab as string}</Td>
                            <Td right>{fm(a as number)}</Td>
                            <Td right>{fm(b as number)}</Td>
                            <Td right className={lab === "Market value" ? pnlClass((b as number) - (a as number)) : ""}>{fm((b as number) - (a as number))}</Td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </DataTable>
                  <div className="p-2 text-[10px] text-muted">
                    Duration rises when yields fall (and vice versa) — the convexity of option-free bonds.
                  </div>
                </Card>
                <Card>
                  <CardHeader title="P&L waterfall by security" tip="Each bar is one holding's full-revaluation P&L; bars accumulate left to right to the portfolio total." />
                  <CardBody>
                    <WaterfallChart items={sc.pnl.map((x) => ({ label: x.label.replace(/^UST /, ""), value: x.pnl_full }))} height={260} caption="USD. Full revaluation per security." />
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader title="Security-level repricing" subtitle="Clean prices per 100 face; YTM change implied by full repricing." />
                <DataTable>
                  <thead>
                    <tr>
                      <Th>Security</Th><Th right>Price before</Th><Th right>Price after</Th><Th right>ΔYTM</Th><Th right>Dmod before→after</Th>
                      <Th right>P&L (full)</Th><Th right>Return</Th><Th right>KRD est.</Th><Th right>KRD+cvx est.</Th><Th right>Share</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {sc.pnl.map((x) => (
                      <tr key={x.id} className="hover:bg-panel2/50">
                        <Td>{x.label}</Td>
                        <Td right>{fmtNum(x.price_before, 3)}</Td>
                        <Td right>{fmtNum(x.price_after, 3)}</Td>
                        <Td right>{fmtBp(x.ytm_change_bp, 1)}</Td>
                        <Td right>{fmtNum(x.duration_before, 2)} → {fmtNum(x.duration_after, 2)}</Td>
                        <Td right className={pnlClass(x.pnl_full)}>{fmtUsd(x.pnl_full, { signed: true })}</Td>
                        <Td right className={pnlClass(x.return_full)}>{fmtSignedPct(x.return_full * 100)}</Td>
                        <Td right className="text-muted">{fmtUsd(x.pnl_krd_approx, { signed: true })}</Td>
                        <Td right className="text-muted">{fmtUsd(x.pnl_krd_convexity_approx, { signed: true })}</Td>
                        <Td right>{fmtPct(x.share_of_pnl * 100, 0)}</Td>
                      </tr>
                    ))}
                    <tr className="bg-panel2/50 font-semibold">
                      <Td>Portfolio</Td><Td /><Td /><Td /><Td right>{fmtNum(sc.base.summary.modified_duration, 2)} → {fmtNum(sc.shocked.summary.modified_duration, 2)}</Td>
                      <Td right className={pnlClass(sc.totals.pnl_full)}>{fmtUsd(sc.totals.pnl_full, { signed: true })}</Td>
                      <Td right className={pnlClass(sc.totals.return_full)}>{fmtSignedPct(sc.totals.return_full * 100)}</Td>
                      <Td right>{fmtUsd(sc.totals.pnl_krd_approx, { signed: true })}</Td>
                      <Td right>{fmtUsd(sc.totals.pnl_krd_convexity_approx, { signed: true })}</Td>
                      <Td right>100%</Td>
                    </tr>
                  </tbody>
                </DataTable>
              </Card>

              <div className="grid gap-3 [&>*]:min-w-0 2xl:grid-cols-2">
                <Card>
                  <CardHeader title="Key-rate durations: before vs after" tip={G.krd} />
                  <CardBody>
                    <TenorBarChart
                      series={[
                        { key: "b", label: "Before", values: sc.base.key_rate_durations },
                        { key: "a", label: "After", values: sc.shocked.key_rate_durations },
                      ]}
                      fmt={(v) => v.toFixed(2)}
                      yLabel="KRD (years)"
                      caption="Market-value-weighted key-rate durations, years. ±1bp triangular par-curve bumps."
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="First-order P&L attribution by key rate" tip={G.pnlApprox} />
                  <CardBody>
                    <TenorBarChart
                      series={[{ key: "p", label: "P&L", values: sc.totals.pnl_by_key_rate }]}
                      fmt={(v) => fmtUsd(v, { d: 0 })}
                      yLabel="P&L (USD)"
                      signColors
                      caption={`−(key-rate DV01 × tenor shock). Sum ${fmtUsd(sc.totals.pnl_krd_approx, { signed: true })} vs full revaluation ${fmtUsd(sc.totals.pnl_full, { signed: true })}; the gap is convexity.`}
                    />
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader title="Assumptions & disclaimer" />
                <CardBody className="space-y-2">
                  <Bullets items={r.assumptions} className="text-muted" />
                  <Bullets items={sc.assumptions} className="text-muted" />
                  <Note tone="warn">{r.translation.disclaimer} {r.policy_after.note}</Note>
                  <div className="flex flex-wrap gap-1">
                    <Badge>Pass-through used:</Badge>
                    {TENORS.map((t) => (
                      <Badge key={t}>{t} {fmtNum(r.translation.loadings.pass_through[t], 2)}</Badge>
                    ))}
                  </div>
                </CardBody>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

