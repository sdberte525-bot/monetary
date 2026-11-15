"use client";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useApi, TENORS, type Provenance, type ScenarioResult } from "@/lib/api";
import { usePortfolios } from "@/lib/portfolio-store";
import { downloadCsv } from "@/lib/csv";
import { fmtBp, fmtNum, fmtPct, fmtSignedPct, fmtUsd, pnlClass, titleCase } from "@/lib/format";
import { G } from "@/lib/glossary";
import { Bullets, PageIntro, SourceLine } from "@/components/common";
import { TenorBarChart, TenorCurveChart, TimeSeriesChart, XYChart } from "@/components/charts";
import { ShockEditor, ZERO_SHOCKS, type Shocks } from "@/components/shock-editor";
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, ErrorBox, Field, Input, Loading, Note, Select, Tabs, TabsContent,
  TabsList, TabsTrigger, Td, Th,
} from "@/components/ui/primitives";

type CurvePayload = {
  as_of: string;
  par_pct: Record<string, number | null>;
  zero_pct: Record<string, number>;
  discount_factors: Record<string, number>;
  zero_curve_dense: { years: number; zero_pct: number; par_pct: number; forward_6m_pct: number }[];
  shape: { spread_2s10s_bp: number | null; spread_3m10y_bp: number | null; shape: string | null; shape_2s10s: string | null; shape_3m10y: string | null; definition: string };
  warnings: string[];
};
type Compare = { a: CurvePayload; b: CurvePayload; change_bp: Record<string, number | null>; move_classification: string | null; provenance: Provenance };
type History = { rows: Record<string, number | string | null>[]; frequency: string; provenance: Provenance };
type Presets = { definitions: Record<string, string> };
type Dates = { first: string; last: string };

const shift = (iso: string, years: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d.toISOString().slice(0, 10);
};

export default function CurvePage() {
  const dates = useApi<Dates>("/api/curve/dates");
  const last = dates.data?.last ?? "";
  const [dateA, setDateA] = useState<string>("");
  const [dateB, setDateB] = useState<string>("");
  const a = dateA || last;
  const b = dateB || (last ? shift(last, 1) : "");
  const cmp = useApi<Compare>(a && b ? `/api/curve/compare?date1=${b}&date2=${a}` : null);

  const [tenorSel, setTenorSel] = useState<string[]>(["3M", "2Y", "10Y", "30Y"]);
  const [range, setRange] = useState("10");
  const start = last ? (range === "max" ? "1990-01-01" : shift(last, Number(range))) : "";
  const hist = useApi<History>(start ? `/api/curve/history?tenors=${[...new Set([...tenorSel, "2Y", "10Y"])].join(",")}&start=${start}` : null);
  const presets = useApi<Presets>("/api/scenarios/presets");

  if (dates.error) return <ErrorBox error={dates.error} onRetry={dates.reload} />;
  if (!dates.data) return <Loading label="Loading curve data" />;

  return (
    <div className="space-y-3">
      <PageIntro>
        Observed U.S. Treasury <b>par</b> yields (Daily Treasury Par Yield Curve, constant-maturity, bond-equivalent) are shown separately from
        the <b>zero-coupon (spot)</b> and forward rates that MONETARY bootstraps from them. Par yields are not zero rates; the bootstrap
        assumptions are listed under Discount Curve and in Methodology. Dates resolve to the last observation on or before the date selected.
      </PageIntro>

      <Card>
        <CardHeader
          title="Curve comparison"
          tip={G.parYield}
          subtitle={cmp.data ? `${cmp.data.b.as_of} vs ${cmp.data.a.as_of} · move classified as ${cmp.data.move_classification ?? "—"} (by 2Y and 10Y changes)` : "Select two dates"}
          right={
            <>
              <Field label="Date A (base)">
                <Input type="date" min={dates.data.first} max={last} value={b} onChange={(e) => setDateB(e.target.value)} className="w-36" />
              </Field>
              <Field label="Date B (compare)">
                <Input type="date" min={dates.data.first} max={last} value={a} onChange={(e) => setDateA(e.target.value)} className="w-36" />
              </Field>
              <Button size="sm" className="self-end" onClick={() => { setDateA(""); setDateB(""); }}>Reset</Button>
            </>
          }
        />
        <CardBody>
          {cmp.error && <ErrorBox error={cmp.error} />}
          {!cmp.data && !cmp.error && <Loading />}
          {cmp.data && (
            <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-5">
              <div className="xl:col-span-3 space-y-2">
                <TenorCurveChart
                  height={280}
                  series={[
                    { key: "a", label: `Date A ${cmp.data.a.as_of}`, values: cmp.data.a.par_pct },
                    { key: "b", label: `Date B ${cmp.data.b.as_of}`, values: cmp.data.b.par_pct },
                  ]}
                  caption="Par yields, percent (semiannual bond-equivalent). Source: U.S. Treasury."
                />
                <TenorBarChart
                  height={170}
                  series={[{ key: "chg", label: "Change", values: cmp.data.change_bp }]}
                  fmt={(v) => `${v.toFixed(0)}`}
                  yLabel="Change (bp)"
                  caption={`Yield change from ${cmp.data.a.as_of} to ${cmp.data.b.as_of}, basis points (1 bp = 0.01%).`}
                />
                <SourceLine prov={cmp.data.provenance} />
              </div>
              <div className="xl:col-span-2 space-y-2">
                <DataTable>
                  <thead>
                    <tr>
                      <Th>Tenor</Th>
                      <Th right>{cmp.data.a.as_of}</Th>
                      <Th right>{cmp.data.b.as_of}</Th>
                      <Th right>Δ bp</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {TENORS.map((t) => (
                      <tr key={t} className="hover:bg-panel2/50">
                        <Td>{t}</Td>
                        <Td right>{fmtNum(cmp.data!.a.par_pct[t])}</Td>
                        <Td right>{fmtNum(cmp.data!.b.par_pct[t])}</Td>
                        <Td right>{fmtBp(cmp.data!.change_bp[t])}</Td>
                      </tr>
                    ))}
                    {(["spread_2s10s_bp", "spread_3m10y_bp"] as const).map((k) => (
                      <tr key={k} className="bg-panel2/40">
                        <Td className="font-medium">{k === "spread_2s10s_bp" ? "10Y–2Y" : "10Y–3M"}</Td>
                        <Td right>{fmtBp(cmp.data!.a.shape[k], 0)}</Td>
                        <Td right>{fmtBp(cmp.data!.b.shape[k], 0)}</Td>
                        <Td right>
                          {cmp.data!.a.shape[k] != null && cmp.data!.b.shape[k] != null ? fmtBp(cmp.data!.b.shape[k]! - cmp.data!.a.shape[k]!, 0) : "—"}
                        </Td>
                      </tr>
                    ))}
                    <tr>
                      <Td className="font-medium">Shape</Td>
                      <Td right><Badge tone={cmp.data.a.shape.shape === "inverted" ? "neg" : cmp.data.a.shape.shape === "flat" ? "warn" : "live"}>{titleCase(cmp.data.a.shape.shape)}</Badge></Td>
                      <Td right><Badge tone={cmp.data.b.shape.shape === "inverted" ? "neg" : cmp.data.b.shape.shape === "flat" ? "warn" : "live"}>{titleCase(cmp.data.b.shape.shape)}</Badge></Td>
                      <Td />
                    </tr>
                  </tbody>
                </DataTable>
                <Note>{cmp.data.a.shape.definition}</Note>
                {[...cmp.data.a.warnings, ...cmp.data.b.warnings].length > 0 && (
                  <Note tone="warn">{[...new Set([...cmp.data.a.warnings, ...cmp.data.b.warnings])].join(" ")}</Note>
                )}
                <Button
                  size="sm"
                  onClick={() =>
                    downloadCsv(
                      TENORS.map((t) => ({ tenor: t, [`par_${cmp.data!.a.as_of}`]: cmp.data!.a.par_pct[t], [`par_${cmp.data!.b.as_of}`]: cmp.data!.b.par_pct[t], change_bp: cmp.data!.change_bp[t], [`zero_${cmp.data!.b.as_of}`]: cmp.data!.b.zero_pct[t] })),
                      `treasury_curve_${cmp.data!.a.as_of}_${cmp.data!.b.as_of}.csv`,
                    )
                  }
                >
                  <Download className="h-3 w-3" /> CSV
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Yield history"
            subtitle={hist.data ? `Frequency: ${hist.data.frequency === "D" ? "daily" : hist.data.frequency === "W" ? "weekly (last obs.)" : "month-end (last obs.)"}` : ""}
            right={
              <>
                {["1", "5", "10", "max"].map((r) => (
                  <Button key={r} size="sm" variant={range === r ? "default" : "outline"} onClick={() => setRange(r)}>
                    {r === "max" ? "Max" : `${r}Y`}
                  </Button>
                ))}
                <Button size="sm" disabled={!hist.data} onClick={() => hist.data && downloadCsv(hist.data.rows, `treasury_history_${start}.csv`)}>
                  <Download className="h-3 w-3" />
                </Button>
              </>
            }
          />
          <CardBody>
            <div className="mb-2 flex flex-wrap gap-1">
              {TENORS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTenorSel((s) => (s.includes(t) ? s.filter((x) => x !== t) : s.length >= 4 ? s : [...s, t]))}
                  className={`rounded border px-1.5 py-0.5 text-2xs ${tenorSel.includes(t) ? "border-accent bg-accent/15 text-fg" : "border-border text-muted hover:text-fg"}`}
                  aria-pressed={tenorSel.includes(t)}
                >
                  {t}
                </button>
              ))}
              <span className="ml-1 self-center text-[10px] text-muted">up to 4 maturities</span>
            </div>
            {hist.error && <ErrorBox error={hist.error} />}
            {!hist.data && !hist.error && <Loading />}
            {hist.data && (
              <>
                <TimeSeriesChart
                  rows={hist.data.rows}
                  series={TENORS.filter((t) => tenorSel.includes(t)).map((t) => ({ key: t, label: t }))}
                  yLabel="Yield (%)"
                  height={240}
                  caption="Par yields, percent. Gaps = tenor not published (e.g. 30Y 2002–2006, 20Y before 1993). Source: U.S. Treasury."
                />
                <TimeSeriesChart
                  rows={hist.data.rows}
                  series={[{ key: "2s10s_bp", label: "10Y–2Y", color: "#c98500" }]}
                  yLabel="Spread (bp)"
                  fmt={(v) => v.toFixed(0)}
                  height={150}
                  zeroLine
                  caption="10Y–2Y par-yield spread, basis points. Below zero = inverted."
                />
              </>
            )}
          </CardBody>
        </Card>

        <DiscountCurveCard date={a} />
      </div>

      <ShockLab definitions={presets.data?.definitions} />
    </div>
  );
}

function DiscountCurveCard({ date }: { date: string }) {
  const c = useApi<CurvePayload & { provenance: Provenance }>(date ? `/api/curve?date=${date}` : null);
  const [spotYears, setSpotYears] = useState("1, 2, 5, 10, 30");
  const [spotRates, setSpotRates] = useState("4.6, 4.8, 5.0, 5.2, 5.5");
  const spotBody = useMemo(() => {
    const ys = spotYears.split(",").map((s) => Number(s.trim()));
    const rs = spotRates.split(",").map((s) => Number(s.trim()));
    if (ys.length < 2 || ys.length !== rs.length || ys.some((x) => !(x > 0)) || rs.some((x) => !Number.isFinite(x))) return null;
    return { years: ys, rates_pct: rs, compounding: "2" };
  }, [spotYears, spotRates]);
  const spot = useApi<{ points: { years: number; discount_factor: number; zero_pct_sa: number; par_pct_sa: number | null }[] }>(spotBody ? "/api/curve/spot" : null, spotBody ?? undefined, 300);

  return (
    <Card>
      <CardHeader title="Discount curve construction" tip={G.zeroRate} subtitle={c.data ? `Bootstrapped from the par curve of ${c.data.as_of}` : ""} />
      <CardBody>
        <Tabs defaultValue="boot">
          <TabsList>
            <TabsTrigger value="boot">Bootstrapped (from par)</TabsTrigger>
            <TabsTrigger value="spot">User-supplied spot rates</TabsTrigger>
          </TabsList>
          <TabsContent value="boot" className="mt-2 space-y-2">
            {c.error && <ErrorBox error={c.error} />}
            {!c.data && !c.error && <Loading />}
            {c.data && (
              <>
                <XYChart
                  height={240}
                  rows={c.data.zero_curve_dense}
                  x="years"
                  xLabel="Maturity (years)"
                  yLabel="Rate (%)"
                  fmtX={(v) => v.toFixed(0)}
                  series={[
                    { key: "par_pct", label: "Par (interpolated)" },
                    { key: "zero_pct", label: "Zero (s.a.)", color: "#199e70" },
                    { key: "forward_6m_pct", label: "6M forward", color: "#c98500", dashed: true },
                  ]}
                  caption="Percent, semiannual compounding, on a 6-month grid. Computed by MONETARY from U.S. Treasury par yields."
                />
                <Bullets
                  className="text-muted"
                  items={[
                    "Par yields are linearly interpolated between published tenors; missing tenors are excluded, never filled.",
                    "Bills (≤1Y) treated as zero-coupon on a bond-equivalent basis: simple interest below 6M, semiannual compounding from 6M to 1Y.",
                    "Beyond 1Y each semiannual node is a par bond: DF(t) = (1 − c/2·ΣDF(tⱼ)) / (1 + c/2).",
                    "Between nodes ln DF is linear (piecewise-flat forwards). On-the-run liquidity premia and day-count detail inside the bootstrap are ignored.",
                    "Forward rates amplify interpolation choices: kinks in the par curve (e.g. when the 20Y yield exceeds the 30Y) produce jumps in the 6M forward. Zero rates are far less sensitive.",
                  ]}
                />
                {c.data.warnings.length > 0 && <Note tone="warn">{c.data.warnings.join(" ")}</Note>}
              </>
            )}
          </TabsContent>
          <TabsContent value="spot" className="mt-2 space-y-2">
            <Note>
              Alternative to bootstrapping: enter your own spot (zero-coupon) rates. The curve is built with log-linear discount-factor
              interpolation; implied par yields are shown for comparison. These are user inputs, not market data.
            </Note>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Maturities (years, comma-separated)">
                <Input value={spotYears} onChange={(e) => setSpotYears(e.target.value)} className="font-sans" />
              </Field>
              <Field label="Spot rates (%, s.a.)">
                <Input value={spotRates} onChange={(e) => setSpotRates(e.target.value)} className="font-sans" />
              </Field>
            </div>
            {!spotBody && <Note tone="warn">Enter matching lists of positive maturities and numeric rates.</Note>}
            {spot.error && <ErrorBox error={spot.error} />}
            {spot.data && (
              <XYChart
                height={220}
                rows={spot.data.points.map((p) => ({ years: p.years, zero: p.zero_pct_sa, par: p.par_pct_sa, df: p.discount_factor }))}
                x="years"
                xLabel="Maturity (years)"
                yLabel="Rate (%)"
                fmtX={(v) => v.toFixed(1)}
                series={[{ key: "zero", label: "Spot (input, interpolated)", color: "#199e70" }, { key: "par", label: "Implied par yield" }]}
                caption="User-supplied hypothetical curve. Percent, semiannual compounding."
              />
            )}
          </TabsContent>
        </Tabs>
      </CardBody>
    </Card>
  );
}

function ShockLab({ definitions }: { definitions?: Record<string, string> }) {
  const [shocks, setShocks] = useState<Shocks>({ ...ZERO_SHOCKS });
  const { active } = usePortfolios();
  const body = active ? { positions: active.positions, shocks_bp: shocks } : undefined;
  const sc = useApi<ScenarioResult>(active ? "/api/portfolio/scenario" : null, body, 250);
  return (
    <Card>
      <CardHeader
        title="Curve shock laboratory"
        subtitle="Parallel shifts, bull/bear steepening and flattening, twists, butterflies, or custom maturity-by-maturity shocks applied to the latest par curve."
      />
      <CardBody className="grid gap-4 xl:grid-cols-2">
        <div className="space-y-3">
          <ShockEditor value={shocks} onChange={setShocks} />
          {definitions && (
            <div className="space-y-1 rounded border border-border p-2">
              <div className="text-2xs font-semibold uppercase tracking-wide text-muted">Steepening & flattening — definitions</div>
              {Object.entries(definitions).map(([k, v]) => (
                <div key={k} className="text-2xs leading-relaxed">
                  <span className="font-semibold text-fg">{titleCase(k.replace("_", " "))}:</span> <span className="text-muted">{v}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-2">
          {sc.error && <ErrorBox error={sc.error} />}
          {!sc.data && !sc.error && <Loading />}
          {sc.data && (
            <>
              <TenorCurveChart
                height={230}
                series={[
                  { key: "base", label: `Base ${sc.data.base.curve_as_of}`, values: sc.data.base_curve_pct },
                  { key: "shock", label: "Shocked (hypothetical)", values: sc.data.shocked_curve_pct },
                ]}
                caption={`Par yields, percent. Move classification: ${sc.data.classification}. 10Y–2Y: ${fmtBp(sc.data.curve_shape_before.spread_2s10s_bp, 0)} → ${fmtBp(sc.data.curve_shape_after.spread_2s10s_bp, 0)}.`}
              />
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded border border-border p-2">
                  <div className="text-2xs uppercase text-muted">{active?.name} P&L</div>
                  <div className={`num text-base font-semibold ${pnlClass(sc.data.totals.pnl_full)}`}>{fmtUsd(sc.data.totals.pnl_full, { signed: true })}</div>
                  <div className={`num ${pnlClass(sc.data.totals.return_full)}`}>{fmtSignedPct(sc.data.totals.return_full * 100)}</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-2xs uppercase text-muted">KRD estimate</div>
                  <div className="num text-base font-semibold">{fmtUsd(sc.data.totals.pnl_krd_approx, { signed: true })}</div>
                  <div className="text-2xs text-muted">first-order</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-2xs uppercase text-muted">Duration after</div>
                  <div className="num text-base font-semibold">{fmtNum(sc.data.shocked.summary.modified_duration)}y</div>
                  <div className="text-2xs text-muted">from {fmtNum(sc.data.base.summary.modified_duration)}y</div>
                </div>
              </div>
              <SourceLine prov={sc.data.provenance} extra="P&L: full revaluation, static positions" />
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

