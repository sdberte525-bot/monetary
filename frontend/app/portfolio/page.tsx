"use client";
import { useEffect, useRef, useState } from "react";
import { Download, Plus, Save, Trash2, Upload, Undo2 } from "lucide-react";
import { useApi, TENORS, type PortfolioAnalytics, type Position, type ScenarioResult } from "@/lib/api";
import { usePortfolios } from "@/lib/portfolio-store";
import { downloadCsv, parsePositionsCsv, POSITION_COLUMNS } from "@/lib/csv";
import { fmtBp, fmtNum, fmtPct, fmtSignedPct, fmtUsd, pnlClass } from "@/lib/format";
import { G } from "@/lib/glossary";
import { Bullets, Metric, PageIntro, SourceLine } from "@/components/common";
import { CategoryBarChart, TenorBarChart, TenorCurveChart } from "@/components/charts";
import { ShockEditor, ZERO_SHOCKS, type Shocks } from "@/components/shock-editor";
import {
  Badge, Button, Card, CardBody, CardHeader, DataTable, ErrorBox, Input, Loading, Note, Select, Tabs, TabsContent,
  TabsList, TabsTrigger, Td, Th,
} from "@/components/ui/primitives";

const newId = () => `P-${Math.random().toString(36).slice(2, 8)}`;

export default function PortfolioPage() {
  const store = usePortfolios();
  const { active } = store;
  const [draft, setDraft] = useState<Position[]>([]);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState("");
  const [importErr, setImportErr] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) {
      setDraft(active.positions);
      setDirty(false);
      setName(active.kind === "user" ? active.name : "");
    }
  }, [active]);

  const valid = draft.length > 0 && draft.every((p) => p.label && p.coupon_pct >= 0 && p.coupon_pct <= 25 && p.face_amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(p.maturity));
  const body = valid ? { positions: draft } : undefined;
  const pa = useApi<PortfolioAnalytics>(valid ? "/api/portfolio/analyze" : null, body, 300);

  const edit = (i: number, k: keyof Position, v: string) => {
    setDraft((d) => d.map((p, j) => (j === i ? { ...p, [k]: k === "label" || k === "maturity" || k === "day_count" || k === "id" ? v : Number(v) } : p)));
    setDirty(true);
  };
  const addRow = () => {
    const last = draft[draft.length - 1];
    setDraft((d) => [...d, { id: newId(), label: "New UST", coupon_pct: last?.coupon_pct ?? 4.5, maturity: last?.maturity ?? "2031-11-15", face_amount: 10_000_000, frequency: 2, day_count: "ACT/ACT-ICMA" }]);
    setDirty(true);
  };
  const commit = () => {
    if (!active) return;
    if (active.kind === "user") store.updatePositions(active.id, draft);
    else {
      const id = store.saveAs(name.trim() || `${active.name} (custom)`, draft);
      store.setActiveId(id);
    }
    setDirty(false);
  };
  const onImport = async (file: File) => {
    const { positions, errors } = parsePositionsCsv(await file.text());
    setImportErr(errors);
    if (!errors.length && positions.length) {
      const id = store.saveAs(file.name.replace(/\.csv$/i, ""), positions);
      store.setActiveId(id);
    }
  };

  if (!active) return store.error ? <ErrorBox error={store.error} /> : <Loading label="Loading portfolios" />;

  return (
    <div className="space-y-3">
      <PageIntro>
        Build and analyze Treasury-style portfolios. Holdings are valued by discounting every cash flow on the bootstrapped Treasury zero
        curve (zero spread). Risk is measured both analytically (modified duration, convexity at each bond&apos;s YTM) and by full revaluation
        (effective duration, key-rate durations). Portfolios are saved in this browser (localStorage). Sample portfolios are hypothetical
        bonds issued at today&apos;s par yields, not actual CUSIPs.
      </PageIntro>

      <Card>
        <CardHeader
          title="Holdings"
          subtitle={
            <>
              {active.name} · <Badge tone={active.kind === "user" ? "user" : "neutral"}>{active.kind === "user" ? "saved portfolio" : "sample (edits save as a copy)"}</Badge>
              {dirty && <Badge tone="warn" className="ml-1">unsaved edits — analytics already reflect them</Badge>}
            </>
          }
          right={
            <>
              <Input placeholder={active.kind === "user" ? "Name" : "Name for saved copy"} value={name} onChange={(e) => setName(e.target.value)} className="w-44 font-sans" />
              {active.kind === "user" && name.trim() && name !== active.name && (
                <Button size="sm" onClick={() => store.rename(active.id, name.trim())}>Rename</Button>
              )}
              <Button size="sm" variant="default" disabled={!valid || (!dirty && active.kind === "user")} onClick={commit}>
                <Save className="h-3 w-3" /> {active.kind === "user" ? "Save" : "Save as new"}
              </Button>
              <Button size="sm" disabled={!valid} onClick={() => { const id = store.saveAs(name.trim() || `${active.name} copy`, draft); store.setActiveId(id); }}>
                Duplicate
              </Button>
              <Button size="sm" disabled={!dirty} onClick={() => { setDraft(active.positions); setDirty(false); }}>
                <Undo2 className="h-3 w-3" /> Revert
              </Button>
              <Button size="sm" onClick={() => downloadCsv(draft as unknown as Record<string, unknown>[], `${active.name.replace(/\W+/g, "_")}.csv`, POSITION_COLUMNS)}>
                <Download className="h-3 w-3" /> Export CSV
              </Button>
              <Button size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3 w-3" /> Import CSV
              </Button>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
              {active.kind === "user" && (
                <Button size="sm" variant="danger" onClick={() => store.remove(active.id)}>
                  <Trash2 className="h-3 w-3" /> Delete
                </Button>
              )}
            </>
          }
        />
        {importErr.length > 0 && <div className="p-2"><ErrorBox error={`CSV import failed: ${importErr.join("; ")}`} /></div>}
        <DataTable>
          <thead>
            <tr>
              <Th>Label</Th><Th right>Coupon %</Th><Th>Maturity</Th><Th right>Face ($)</Th><Th>Freq</Th><Th>Day count</Th><Th />
            </tr>
          </thead>
          <tbody>
            {draft.map((p, i) => (
              <tr key={p.id}>
                <Td className="min-w-[200px]"><Input aria-label="Label" value={p.label} onChange={(e) => edit(i, "label", e.target.value)} className="font-sans" /></Td>
                <Td><Input aria-label="Coupon percent" type="number" step={0.125} min={0} max={25} value={p.coupon_pct} onChange={(e) => edit(i, "coupon_pct", e.target.value)} className="w-24 text-right" /></Td>
                <Td><Input aria-label="Maturity" type="date" value={p.maturity} onChange={(e) => edit(i, "maturity", e.target.value)} className="w-36" /></Td>
                <Td><Input aria-label="Face amount" type="number" step={1000000} min={0} value={Math.round(p.face_amount)} onChange={(e) => edit(i, "face_amount", e.target.value)} className="w-36 text-right" /></Td>
                <Td>
                  <Select value={String(p.frequency)} onChange={(v) => edit(i, "frequency", v)} options={[{ value: "1", label: "1" }, { value: "2", label: "2" }, { value: "4", label: "4" }, { value: "12", label: "12" }]} />
                </Td>
                <Td>
                  <Select value={p.day_count} onChange={(v) => edit(i, "day_count", v)} options={["ACT/ACT-ICMA", "30/360", "ACT/360", "ACT/365F"].map((d) => ({ value: d, label: d }))} />
                </Td>
                <Td>
                  <Button size="icon" variant="ghost" aria-label="Remove position" disabled={draft.length <= 1} onClick={() => { setDraft((d) => d.filter((_, j) => j !== i)); setDirty(true); }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <div className="flex items-center gap-2 p-2">
          <Button size="sm" onClick={addRow}><Plus className="h-3 w-3" /> Add bond</Button>
          {!valid && <span className="text-2xs text-warn">Each position needs a label, coupon 0–25%, a valid maturity and positive face.</span>}
          <span className="ml-auto text-[10px] text-muted">CSV columns: {POSITION_COLUMNS.join(", ")} (coupon in percent, maturity YYYY-MM-DD)</span>
        </div>
      </Card>

      {pa.error && <ErrorBox error={pa.error} onRetry={pa.reload} />}
      {valid && !pa.data && !pa.error && <Loading />}
      {pa.data && <Analytics a={pa.data} />}

      <Tabs defaultValue="scenario">
        <TabsList>
          <TabsTrigger value="scenario">Scenario P&L attribution</TabsTrigger>
          <TabsTrigger value="compare">Compare portfolios</TabsTrigger>
        </TabsList>
        <TabsContent value="scenario" className="mt-3">{valid && <ScenarioPanel positions={draft} />}</TabsContent>
        <TabsContent value="compare" className="mt-3">{valid && <ComparePanel positions={draft} name={active.name} />}</TabsContent>
      </Tabs>
    </div>
  );
}

function Analytics({ a }: { a: PortfolioAnalytics }) {
  const s = a.summary;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="Market value" tip={G.marketValue} value={fmtUsd(s.market_value)} sub={`accrued ${fmtUsd(s.accrued_interest)}`} />
        <Metric label="Modified duration" tip={G.modDur} value={`${fmtNum(s.modified_duration, 3)}y`} />
        <Metric label="Effective duration" tip={G.effDur} value={`${fmtNum(s.effective_duration, 3)}y`} />
        <Metric label="Convexity" tip={G.convexity} value={fmtNum(s.convexity, 2)} />
        <Metric label="DV01" tip={G.dv01} value={fmtUsd(s.dv01, { compact: false })} sub="per +1 bp" />
        <Metric label="Cash-flow yield" tip={G.cashFlowYield} value={fmtPct(s.cash_flow_yield_pct, 3)} sub="s.a. bond-equivalent" />
        <Metric label="MV-wtd YTM" tip={G.mvYtm} value={fmtPct(s.mv_weighted_ytm_pct, 3)} sub="approximation" />
        <Metric label="Concentration (HHI)" tip={G.hhi} value={fmtNum(a.concentration.hhi, 3)} sub={`${fmtNum(a.concentration.effective_positions, 1)} effective positions`} valueClass={a.concentration.warnings.length ? "text-warn" : ""} />
      </div>
      {a.concentration.warnings.length > 0 && <Note tone="warn">⚠ Concentration risk: {a.concentration.warnings.join(" ")}</Note>}
      {a.curve_warnings.length > 0 && <Note tone="warn">{a.curve_warnings.join(" ")}</Note>}

      <Card>
        <CardHeader
          title="Holdings analytics"
          subtitle={`Settlement ${a.settlement} (T+1) · curve ${a.curve_as_of}`}
          right={<Button size="sm" onClick={() => downloadCsv(a.holdings.map(({ krd, kr_dv01, ...h }) => ({ ...h, ...Object.fromEntries(Object.entries(kr_dv01).map(([k, v]) => [`krdv01_${k}`, v])) })), "holdings_analytics.csv")}><Download className="h-3 w-3" /> CSV</Button>}
        />
        <DataTable>
          <thead>
            <tr>
              <Th>Security</Th><Th right>Clean</Th><Th right>Accrued</Th><Th right>YTM %</Th><Th right>Market value</Th><Th right>Weight</Th>
              <Th right>Dmod</Th><Th right>Deff</Th><Th right>Convexity</Th><Th right>DV01</Th><Th right>DV01 share</Th><Th right>Dur. contrib.</Th>
            </tr>
          </thead>
          <tbody>
            {a.holdings.map((h) => (
              <tr key={h.id} className="hover:bg-panel2/50">
                <Td>{h.label}</Td>
                <Td right>{fmtNum(h.clean_price, 3)}</Td>
                <Td right>{fmtNum(h.accrued_per_100, 3)}</Td>
                <Td right>{fmtNum(h.ytm_pct, 3)}</Td>
                <Td right>{fmtUsd(h.market_value, { compact: false })}</Td>
                <Td right>{fmtPct(h.weight * 100, 1)}</Td>
                <Td right>{fmtNum(h.modified_duration, 3)}</Td>
                <Td right>{fmtNum(h.effective_duration, 3)}</Td>
                <Td right>{fmtNum(h.convexity, 1)}</Td>
                <Td right>{fmtUsd(h.dv01, { compact: false })}</Td>
                <Td right className={h.dv01_share > a.concentration.thresholds.max_dv01_share ? "text-warn" : ""}>{fmtPct(h.dv01_share * 100, 1)}</Td>
                <Td right>{fmtNum(h.duration_contribution, 3)}</Td>
              </tr>
            ))}
            <tr className="bg-panel2/50 font-semibold">
              <Td>Portfolio</Td><Td /><Td /><Td right>{fmtNum(a.summary.mv_weighted_ytm_pct, 3)}</Td><Td right>{fmtUsd(a.summary.market_value, { compact: false })}</Td><Td right>100%</Td>
              <Td right>{fmtNum(a.summary.modified_duration, 3)}</Td><Td right>{fmtNum(a.summary.effective_duration, 3)}</Td><Td right>{fmtNum(a.summary.convexity, 1)}</Td>
              <Td right>{fmtUsd(a.summary.dv01, { compact: false })}</Td><Td right>100%</Td><Td right>{fmtNum(a.summary.modified_duration, 3)}</Td>
            </tr>
          </tbody>
        </DataTable>
      </Card>

      <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-3">
        <Card>
          <CardHeader title="Maturity distribution" subtitle="Market value by years-to-maturity bucket" />
          <CardBody>
            <CategoryBarChart
              rows={a.maturity_buckets.map((b) => ({ name: b.bucket, mv: b.market_value }))}
              series={[{ key: "mv", label: "Market value" }]}
              fmt={(v) => fmtUsd(v, { d: 0 })}
              xLabel="Market value (USD)"
              height={230}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Duration contribution" tip="Weight × modified duration; sums to portfolio modified duration." />
          <CardBody>
            <CategoryBarChart
              rows={a.holdings.map((h) => ({ name: h.label.replace(/^UST /, ""), c: h.duration_contribution }))}
              series={[{ key: "c", label: "Contribution (years)" }]}
              fmt={(v) => v.toFixed(2)}
              xLabel="Years of duration"
              height={230}
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Key-rate DV01" tip={G.krDv01} />
          <CardBody>
            <TenorBarChart series={[{ key: "k", label: "KR-DV01", values: a.key_rate_dv01 }]} fmt={(v) => fmtUsd(v, { d: 0 })} yLabel="$ per bp" height={230} />
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Key-rate durations & conventions" tip={G.krd} />
        <CardBody className="grid gap-3">
          <DataTable>
            <thead><tr><Th>Tenor</Th>{TENORS.map((t) => <Th key={t} right>{t}</Th>)}<Th right>Σ</Th></tr></thead>
            <tbody>
              <tr><Td>KRD (y)</Td>{TENORS.map((t) => <Td key={t} right>{fmtNum(a.key_rate_durations[t], 3)}</Td>)}<Td right>{fmtNum(Object.values(a.key_rate_durations).reduce((x, y) => x + y, 0), 3)}</Td></tr>
              <tr><Td>KR-DV01</Td>{TENORS.map((t) => <Td key={t} right>{fmtUsd(a.key_rate_dv01[t], { d: 0 })}</Td>)}<Td right>{fmtUsd(Object.values(a.key_rate_dv01).reduce((x, y) => x + y, 0), { d: 0 })}</Td></tr>
            </tbody>
          </DataTable>
          <div className="space-y-1">
            {Object.entries(a.conventions).map(([k, v]) => (
              <div key={k} className="text-[11px] text-muted"><span className="font-semibold text-fg">{k}:</span> {v}</div>
            ))}
            <Bullets className="text-muted" items={a.assumptions} />
            <SourceLine prov={a.provenance} />
          </div>
        </CardBody>
      </Card>
    </>
  );
}

function ScenarioPanel({ positions }: { positions: Position[] }) {
  const [shocks, setShocks] = useState<Shocks>({ ...ZERO_SHOCKS, ...Object.fromEntries(TENORS.map((t) => [t, 50])) });
  const sc = useApi<ScenarioResult>("/api/portfolio/scenario", { positions, shocks_bp: shocks }, 250);
  return (
    <Card>
      <CardHeader title="Scenario P&L attribution" subtitle="Full cash-flow revaluation vs key-rate duration approximations (static positions, instantaneous shock)." />
      <CardBody className="grid gap-4 xl:grid-cols-[minmax(0,420px)_1fr]">
        <ShockEditor value={shocks} onChange={setShocks} initialParallel={50} />
        <div className="min-w-0 space-y-2">
          {sc.error && <ErrorBox error={sc.error} />}
          {!sc.data && !sc.error && <Loading />}
          {sc.data && (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <Metric label="P&L (full)" tip={G.pnlFull} value={fmtUsd(sc.data.totals.pnl_full, { signed: true })} valueClass={pnlClass(sc.data.totals.pnl_full)} sub={fmtSignedPct(sc.data.totals.return_full * 100)} />
                <Metric label="KRD estimate" tip={G.pnlApprox} value={fmtUsd(sc.data.totals.pnl_krd_approx, { signed: true })} sub={`error ${fmtUsd(sc.data.totals.pnl_krd_approx - sc.data.totals.pnl_full, { signed: true })}`} />
                <Metric label="KRD + convexity" tip={G.pnlCvx} value={fmtUsd(sc.data.totals.pnl_krd_convexity_approx, { signed: true })} sub={`error ${fmtUsd(sc.data.totals.pnl_krd_convexity_approx - sc.data.totals.pnl_full, { signed: true })}`} />
                <Metric label="Curve move" tip={G.s2s10} value={<span className="text-sm">{sc.data.classification}</span>} sub={`2s10s ${fmtBp(sc.data.curve_shape_before.spread_2s10s_bp, 0)} → ${fmtBp(sc.data.curve_shape_after.spread_2s10s_bp, 0)}`} />
              </div>
              <DataTable>
                <thead>
                  <tr><Th>Security</Th><Th right>MV before</Th><Th right>Δy eff.</Th><Th right>P&L full</Th><Th right>Return</Th><Th right>KRD est.</Th><Th right>KRD+cvx</Th><Th right>Share</Th></tr>
                </thead>
                <tbody>
                  {sc.data.pnl.map((r) => (
                    <tr key={r.id} className="hover:bg-panel2/50">
                      <Td>{r.label}</Td>
                      <Td right>{fmtUsd(r.market_value_before)}</Td>
                      <Td right>{fmtBp(r.effective_yield_change_bp, 1)}</Td>
                      <Td right className={pnlClass(r.pnl_full)}>{fmtUsd(r.pnl_full, { signed: true })}</Td>
                      <Td right className={pnlClass(r.return_full)}>{fmtSignedPct(r.return_full * 100)}</Td>
                      <Td right className="text-muted">{fmtUsd(r.pnl_krd_approx, { signed: true })}</Td>
                      <Td right className="text-muted">{fmtUsd(r.pnl_krd_convexity_approx, { signed: true })}</Td>
                      <Td right>{fmtPct(r.share_of_pnl * 100, 0)}</Td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
              <div className="grid gap-2 lg:grid-cols-2">
                <TenorCurveChart height={200} series={[{ key: "b", label: "Base", values: sc.data.base_curve_pct }, { key: "s", label: "Shocked", values: sc.data.shocked_curve_pct }]} caption="Par yields, %." />
                <TenorBarChart height={200} series={[{ key: "p", label: "P&L", values: sc.data.totals.pnl_by_key_rate }]} fmt={(v) => fmtUsd(v, { d: 0 })} yLabel="P&L (USD)" signColors caption="First-order P&L by key rate." />
              </div>
              <Button size="sm" onClick={() => downloadCsv(sc.data!.pnl as unknown as Record<string, unknown>[], "scenario_pnl_attribution.csv")}><Download className="h-3 w-3" /> Attribution CSV</Button>
            </>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

type CompareResp = {
  a: { name: string; analytics: PortfolioAnalytics; scenario_totals: ScenarioResult["totals"] };
  b: { name: string; analytics: PortfolioAnalytics; scenario_totals: ScenarioResult["totals"] };
  standard_scenarios: Record<string, { label: string; a: number; b: number }>;
  curve_as_of: string;
};

function ComparePanel({ positions, name }: { positions: Position[]; name: string }) {
  const { portfolios } = usePortfolios();
  const [other, setOther] = useState("sample:barbell");
  const b = portfolios.find((p) => p.id === other);
  const r = useApi<CompareResp>(b ? "/api/portfolio/compare" : null, b ? { a: positions, b: b.positions, name_a: name, name_b: b.name } : undefined, 200);
  return (
    <Card>
      <CardHeader
        title="Portfolio comparison"
        subtitle="Same curve, same scenarios, full revaluation."
        right={<Select ariaLabel="Comparison portfolio" value={other} onChange={setOther} options={portfolios.map((p) => ({ value: p.id, label: p.name }))} />}
      />
      <CardBody>
        {r.error && <ErrorBox error={r.error} />}
        {!r.data && !r.error && <Loading />}
        {r.data && (
          <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-2">
            <DataTable>
              <thead><tr><Th>Metric</Th><Th right>{r.data.a.name}</Th><Th right>{r.data.b.name}</Th></tr></thead>
              <tbody>
                {([
                  ["Market value", (x: PortfolioAnalytics) => fmtUsd(x.summary.market_value)],
                  ["Modified duration", (x: PortfolioAnalytics) => fmtNum(x.summary.modified_duration, 3)],
                  ["Convexity", (x: PortfolioAnalytics) => fmtNum(x.summary.convexity, 2)],
                  ["DV01", (x: PortfolioAnalytics) => fmtUsd(x.summary.dv01, { compact: false })],
                  ["Cash-flow yield", (x: PortfolioAnalytics) => fmtPct(x.summary.cash_flow_yield_pct, 3)],
                  ["Wtd. avg. maturity", (x: PortfolioAnalytics) => `${fmtNum(x.summary.weighted_avg_maturity, 2)}y`],
                  ["HHI", (x: PortfolioAnalytics) => fmtNum(x.concentration.hhi, 3)],
                ] as [string, (x: PortfolioAnalytics) => string][]).map(([k, f]) => (
                  <tr key={k}><Td>{k}</Td><Td right>{f(r.data!.a.analytics)}</Td><Td right>{f(r.data!.b.analytics)}</Td></tr>
                ))}
                {Object.entries(r.data.standard_scenarios).map(([k, v]) => (
                  <tr key={k}>
                    <Td className="text-muted">Return: {v.label}</Td>
                    <Td right className={pnlClass(v.a)}>{fmtSignedPct(v.a * 100)}</Td>
                    <Td right className={pnlClass(v.b)}>{fmtSignedPct(v.b * 100)}</Td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <TenorBarChart
              series={[{ key: "a", label: r.data.a.name, values: r.data.a.analytics.key_rate_durations }, { key: "b", label: r.data.b.name, values: r.data.b.analytics.key_rate_durations }]}
              fmt={(v) => v.toFixed(2)}
              yLabel="KRD (years)"
              height={280}
              caption={`Key-rate durations on the ${r.data.curve_as_of} curve. Equal total duration can hide very different curve exposures.`}
            />
          </div>
        )}
      </CardBody>
    </Card>
  );
}
