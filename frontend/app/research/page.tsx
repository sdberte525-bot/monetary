"use client";
import { useState } from "react";
import { ArrowRight, FileDown } from "lucide-react";
import { apiDownload, useApi, type Provenance } from "@/lib/api";
import { usePortfolios } from "@/lib/portfolio-store";
import { downloadCsv } from "@/lib/csv";
import { fmtNum, fmtPct, fmtSignedPct, fmtUsd, pnlClass } from "@/lib/format";
import { Bullets, PageIntro } from "@/components/common";
import { TimeSeriesChart } from "@/components/charts";
import { ShockEditor, ZERO_SHOCKS, type Shocks } from "@/components/shock-editor";
import {
  Button, Card, CardBody, CardHeader, DataTable, ErrorBox, Field, Input, Loading, Note, Select, Tabs, TabsContent, TabsList,
  TabsTrigger, Td, Th,
} from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

type Ind = { label: string; units: string; series: string };
type Stats = { n: number; mean: number; std: number; min: number; p25: number; median: number; p75: number; max: number; last: number; last_date: string; first_date: string };
type Overview = { rows: Record<string, number | string | null>[]; latest: Record<string, Stats>; indicators: Record<string, Ind>; provenance: Record<string, Provenance> };
type Dash = {
  x: Ind & { key: string; stats: Stats; lag_months: number }; y: Ind & { key: string; stats: Stats };
  observations: { date: string; x: number; y: number }[];
  correlation_levels: number; correlation_changes: number | null; change_horizon_months: number; n_levels: number; n_changes: number;
  rolling_window_months: number; rolling_correlation_levels: { date: string; value: number }[]; rolling_correlation_changes: { date: string; value: number }[];
  methodology: string[];
};
type Corr = { keys: string[]; matrix: number[][]; n: number };

const GROUPS: Record<string, string[]> = {
  "Policy & yields": ["fed_funds", "ust_3m", "ust_2y", "ust_10y"],
  Inflation: ["cpi_yoy", "core_pce_yoy", "fed_funds"],
  "Labor market": ["unemployment", "fed_funds"],
  "Curve spreads": ["spread_10y2y", "spread_10y3m"],
};

export default function ResearchPage() {
  return (
    <div className="space-y-3">
      <PageIntro>
        Macro context from official FRED data and a calculation-based research-brief generator. Statistics here are descriptive:
        correlation does not establish causation, and these series are highly persistent. Brief commentary is assembled only from
        computed outputs — no news, statements or forecasts are generated.
      </PageIntro>
      <Tabs defaultValue="macro">
        <TabsList>
          <TabsTrigger value="macro">Monetary policy research dashboard</TabsTrigger>
          <TabsTrigger value="brief">Research brief generator</TabsTrigger>
        </TabsList>
        <TabsContent value="macro" className="mt-3 space-y-3"><Macro /></TabsContent>
        <TabsContent value="brief" className="mt-3"><Brief /></TabsContent>
      </Tabs>
    </div>
  );
}

function Macro() {
  const [start, setStart] = useState("2000-01-01");
  const ov = useApi<Overview>(`/api/macro/overview?start=${start}`);
  const [group, setGroup] = useState("Policy & yields");
  const [x, setX] = useState("core_pce_yoy");
  const [y, setY] = useState("ust_10y");
  const [win, setWin] = useState(36);
  const [lag, setLag] = useState(0);
  const [hor, setHor] = useState(12);
  const [end, setEnd] = useState("");
  const dash = useApi<Dash>(`/api/macro/dashboard?x=${x}&y=${y}&start=${start}${end ? `&end=${end}` : ""}&window=${win}&lag=${lag}&horizon=${hor}`);
  const corr = useApi<Corr>(`/api/macro/correlations?start=${start}${end ? `&end=${end}` : ""}`);
  const opts = ov.data ? Object.entries(ov.data.indicators).map(([k, v]) => ({ value: k, label: v.label })) : [];

  if (ov.error) return <ErrorBox error={ov.error} />;
  if (!ov.data) return <Loading label="Loading FRED data" />;
  const ind = ov.data.indicators;

  return (
    <>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="From"><Input type="date" value={start} min="1990-01-01" onChange={(e) => setStart(e.target.value || "2000-01-01")} className="w-36" /></Field>
        <Field label="To (optional)"><Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-36" /></Field>
        {["1990-01-01", "2000-01-01", "2008-01-01", "2019-01-01"].map((d) => (
          <Button key={d} size="sm" variant={start === d ? "default" : "outline"} onClick={() => setStart(d)}>since {d.slice(0, 4)}</Button>
        ))}
      </div>

      <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Indicators"
            right={<Select value={group} onChange={setGroup} options={Object.keys(GROUPS).map((g) => ({ value: g, label: g }))} />}
          />
          <CardBody>
            <TimeSeriesChart
              rows={ov.data.rows}
              height={270}
              yLabel={group === "Curve spreads" ? "Percentage points" : "Percent"}
              zeroLine={group === "Curve spreads"}
              series={GROUPS[group].map((k) => ({ key: k, label: ind[k].label }))}
              caption="Monthly. Daily series = monthly averages; inflation = 12-month % change of the SA price index. Source: FRED (Federal Reserve Bank of St. Louis)."
            />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Latest observations" subtitle="Monthly-transformed values; dates are reference months" />
          <DataTable>
            <thead><tr><Th>Indicator</Th><Th right>Latest</Th><Th>Month</Th><Th right>Mean</Th></tr></thead>
            <tbody>
              {Object.entries(ov.data.latest).map(([k, s]) => (
                <tr key={k} className="hover:bg-panel2/50">
                  <Td className="max-w-[180px] truncate" title={ind[k].label}>{ind[k].label}</Td>
                  <Td right>{fmtNum(s.last, 2)}</Td>
                  <Td className="num text-muted">{s.last_date?.slice(0, 7)}</Td>
                  <Td right className="text-muted">{fmtNum(s.mean, 2)}</Td>
                </tr>
              ))}
            </tbody>
          </DataTable>
          <div className="p-2 text-[10px] text-muted">
            Mean over each series&apos; full available history. Series:{" "}
            {Object.entries(ov.data.provenance).map(([sid, p]) => (
              <a key={sid} href={p.url ?? "#"} target="_blank" rel="noreferrer" className="mr-1.5 inline-block hover:text-fg">{sid}{p.mode === "live" ? "●" : ""}</a>
            ))}
            (● = refreshed live this session; others from snapshot)
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Indicator vs Treasury yield"
          subtitle="Compare an economic indicator with a yield or spread. Descriptive statistics only — correlation does not prove causation."
          right={
            <>
              <Field label="Indicator (x)"><Select value={x} onChange={setX} options={opts} /></Field>
              <Field label="Yield / rate (y)"><Select value={y} onChange={setY} options={opts} /></Field>
              <Field label="Lag x (months)" ><Input type="number" min={0} max={24} value={lag} onChange={(e) => setLag(Math.max(0, Math.min(24, Number(e.target.value) || 0)))} className="w-16" /></Field>
              <Field label="Rolling window"><Input type="number" min={6} max={240} value={win} onChange={(e) => setWin(Math.max(6, Math.min(240, Number(e.target.value) || 36)))} className="w-16" /></Field>
              <Field label="Change horizon"><Select value={String(hor)} onChange={(v) => setHor(Number(v))} options={[1, 3, 6, 12].map((h) => ({ value: String(h), label: `${h}m` }))} /></Field>
            </>
          }
        />
        <CardBody>
          {dash.error && <ErrorBox error={dash.error} />}
          {!dash.data && !dash.error && <Loading />}
          {dash.data && (
            <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-3">
              <div className="xl:col-span-2 space-y-2">
                <TimeSeriesChart
                  rows={dash.data.observations}
                  height={230}
                  yLabel={`${dash.data.x.units} / ${dash.data.y.units}`}
                  series={[{ key: "x", label: `${dash.data.x.label}${lag ? ` (lagged ${lag}m)` : ""}` }, { key: "y", label: dash.data.y.label }]}
                  caption="Both series on one axis (same units: percent or percentage points). Monthly."
                />
                <TimeSeriesChart
                  rows={dash.data.rolling_correlation_levels.map((r, i) => ({ date: r.date, levels: r.value, changes: dash.data!.rolling_correlation_changes.find((c) => c.date === r.date)?.value ?? null, _i: i }))}
                  height={170}
                  yLabel="Correlation"
                  zeroLine
                  series={[{ key: "levels", label: `Rolling ${win}m corr. (levels)` }, { key: "changes", label: `Rolling ${win}m corr. (${hor}m changes)` }]}
                  caption="Pearson correlation over a trailing window, range −1 to +1."
                />
                <Button size="sm" onClick={() => downloadCsv(dash.data!.observations, `${x}_vs_${y}.csv`)}>CSV</Button>
              </div>
              <div className="space-y-2">
                <DataTable>
                  <thead><tr><Th>Statistic</Th><Th right>{dash.data.x.key}</Th><Th right>{dash.data.y.key}</Th></tr></thead>
                  <tbody>
                    {(["n", "mean", "std", "min", "median", "max", "last"] as const).map((k) => (
                      <tr key={k}><Td>{k}</Td><Td right>{k === "n" ? dash.data!.x.stats.n : fmtNum(dash.data!.x.stats[k], 2)}</Td><Td right>{k === "n" ? dash.data!.y.stats.n : fmtNum(dash.data!.y.stats[k], 2)}</Td></tr>
                    ))}
                    <tr className="bg-panel2/50"><Td>Corr. (levels)</Td><Td right colSpan={2}>{fmtNum(dash.data.correlation_levels, 3)} (n={dash.data.n_levels})</Td></tr>
                    <tr className="bg-panel2/50"><Td>Corr. ({hor}m changes)</Td><Td right colSpan={2}>{fmtNum(dash.data.correlation_changes, 3)} (n={dash.data.n_changes})</Td></tr>
                  </tbody>
                </DataTable>
                <Note tone="warn">Correlation does not prove causation. Inflation or unemployment do not mechanically determine bond yields; both respond to common shocks, policy expectations and term premia.</Note>
                <Bullets className="text-muted" items={dash.data.methodology} />
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-2">
        <Card>
          <CardHeader title="Correlation matrix (levels)" subtitle={corr.data ? `Monthly, n = ${corr.data.n} common observations` : ""} />
          <CardBody>
            {corr.error && <ErrorBox error={corr.error} />}
            {corr.data && (
              <DataTable>
                <thead><tr><Th />{corr.data.keys.map((k) => <Th key={k} right>{k}</Th>)}</tr></thead>
                <tbody>
                  {corr.data.matrix.map((row, i) => (
                    <tr key={i}>
                      <Td className="text-muted">{corr.data!.keys[i]}</Td>
                      {row.map((v, j) => (
                        <Td key={j} right style={{ background: v >= 0 ? `rgba(57,135,229,${Math.abs(v) * 0.45})` : `rgba(230,103,103,${Math.abs(v) * 0.45})` }}>{v.toFixed(2)}</Td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </DataTable>
            )}
            <p className="mt-1 text-[10px] text-muted">Blue = positive, red = negative; intensity ∝ |ρ|. Values printed in each cell.</p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Monetary policy transmission (conceptual)" subtitle="Simplified schematic — channels interact and their strength varies over time." />
          <CardBody><TransmissionDiagram /></CardBody>
        </Card>
      </div>
    </>
  );
}

function Box({ title, body, tone = "n" }: { title: string; body: string; tone?: "n" | "a" | "g" }) {
  return (
    <div className={cn("rounded border p-2", tone === "a" ? "border-accent/60 bg-accent/10" : tone === "g" ? "border-[#199e70]/60 bg-[#199e70]/10" : "border-border bg-panel2/60")}>
      <div className="text-xs font-semibold">{title}</div>
      <div className="mt-0.5 text-[11px] leading-snug text-muted">{body}</div>
    </div>
  );
}

function TransmissionDiagram() {
  const arrow = <ArrowRight className="mx-auto h-4 w-4 rotate-90 text-muted md:rotate-0" />;
  return (
    <div className="space-y-2">
      <div className="grid items-center gap-1 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <Box tone="a" title="FOMC decision" body="Target range for fed funds; statement, projections, balance-sheet policy." />
        {arrow}
        <Box title="Short-term rates" body="Overnight rates (EFFR, repo) and bills move with the target almost one-for-one." />
        {arrow}
        <Box title="Expected policy path" body="Guidance and data revise expected future short rates — the main driver of 1–5Y yields." />
      </div>
      <div className="grid items-center gap-1 md:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <Box tone="g" title="Treasury yields" body="≈ average expected short rate + term premium. Long yields can move opposite to the policy rate." />
        {arrow}
        <Box title="Financial conditions" body="Mortgage & corporate rates, credit spreads, the dollar, equity valuations." />
        {arrow}
        <Box title="Economy & inflation" body="Spending, employment and prices respond with long and variable lags." />
      </div>
      <Note>Feedback: inflation and labor data change expectations of future policy, which feed back into yields before any decision is taken. This is why the simulator separates the policy surprise, path revision and term-premium channels.</Note>
    </div>
  );
}

type BriefT = {
  title: string;
  generated_at_utc: string;
  sections: {
    market_environment: string[];
    scenario_assumptions: string[];
    portfolio_composition: { label: string; weight: number; market_value: number; modified_duration: number; dv01: number }[];
    interest_rate_risk: { market_value: number; modified_duration: number; effective_duration: number; convexity: number; dv01: number; cash_flow_yield_pct: number };
    key_rate_exposures: { krd: Record<string, number>; kr_dv01: Record<string, number> };
    scenario_pnl: { pnl_full: number; return_full: number; pnl_krd_approx: number; pnl_krd_convexity_approx: number; pnl_by_key_rate: Record<string, number> };
    main_drivers: { label: string; pnl: number; share: number }[];
    commentary: string[];
    limitations: string[];
    implications: string[];
    sources: string[];
  };
};

function Brief() {
  const { portfolios, activeId } = usePortfolios();
  const [pid, setPid] = useState(activeId);
  const p = portfolios.find((x) => x.id === pid) ?? portfolios.find((x) => x.id === activeId);
  const [src, setSrc] = useState<"policy" | "shocks">("policy");
  const [move, setMove] = useState(-25);
  const [interp, setInterp] = useState("dovish_surprise");
  const [shocks, setShocks] = useState<Shocks>({ ...ZERO_SHOCKS, "10Y": 25 });
  const [err, setErr] = useState<string | null>(null);
  const reqBody = p
    ? src === "policy"
      ? { positions: p.positions, portfolio_name: p.name, policy: { policy_move_bp: move, interpretation: interp } }
      : { positions: p.positions, portfolio_name: p.name, shocks_bp: shocks, scenario_label: "Custom Treasury curve shock (hypothetical)" }
    : undefined;
  const b = useApi<BriefT>(reqBody ? "/api/report/brief" : null, reqBody, 300);
  const s = b.data?.sections;

  return (
    <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-[380px_1fr]">
      <Card>
        <CardHeader title="Brief inputs" />
        <CardBody className="space-y-3">
          <Field label="Portfolio"><Select value={p?.id ?? ""} onChange={setPid} options={portfolios.map((x) => ({ value: x.id, label: x.name }))} /></Field>
          <Field label="Scenario source">
            <Select value={src} onChange={(v) => setSrc(v as "policy" | "shocks")} options={[{ value: "policy", label: "Monetary policy scenario" }, { value: "shocks", label: "Custom curve shock" }]} />
          </Field>
          {src === "policy" ? (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Policy move (bp)"><Select value={String(move)} onChange={(v) => setMove(Number(v))} options={[-100, -50, -25, 0, 25, 50, 100].map((m) => ({ value: String(m), label: `${m > 0 ? "+" : ""}${m}` }))} /></Field>
              <Field label="Interpretation">
                <Select value={interp} onChange={setInterp} options={[["expected", "Expected"], ["hawkish_surprise", "Hawkish surprise"], ["dovish_surprise", "Dovish surprise"], ["inflation_shock", "Inflation shock"], ["recession_shock", "Recession shock"], ["higher_for_longer", "Higher for longer"]].map(([v, l]) => ({ value: v, label: l }))} />
              </Field>
              <div className="col-span-2"><Note>Uses the simulator&apos;s default transmission assumptions. For full control use the Monetary Policy Simulator&apos;s PDF export.</Note></div>
            </div>
          ) : (
            <ShockEditor value={shocks} onChange={setShocks} />
          )}
          <Button
            variant="default"
            disabled={!reqBody}
            onClick={async () => {
              setErr(null);
              try {
                await apiDownload("/api/report/pdf", reqBody, "monetary_research_brief.pdf");
              } catch (e) {
                setErr((e as Error).message);
              }
            }}
          >
            <FileDown className="h-3.5 w-3.5" /> Export PDF
          </Button>
          {err && <ErrorBox error={err} />}
        </CardBody>
      </Card>
      <Card>
        {b.error && <ErrorBox error={b.error} />}
        {!b.data && !b.error && <Loading label="Generating brief" />}
        {b.data && s && (
          <article className="mx-auto max-w-4xl space-y-4 p-5">
            <header className="border-b border-border pb-2">
              <h2 className="text-lg font-semibold">{b.data.title}</h2>
              <p className="text-[10px] text-muted">Generated {b.data.generated_at_utc} · calculation-based commentary · not investment advice</p>
            </header>
            <Section title="Market environment"><Bullets items={s.market_environment} /></Section>
            <Section title="Scenario assumptions"><Bullets items={s.scenario_assumptions} /></Section>
            <Section title="Portfolio composition & interest-rate risk">
              <DataTable>
                <thead><tr><Th>Security</Th><Th right>Weight</Th><Th right>MV</Th><Th right>Dmod</Th><Th right>DV01</Th></tr></thead>
                <tbody>
                  {s.portfolio_composition.map((c) => (
                    <tr key={c.label}><Td>{c.label}</Td><Td right>{fmtPct(c.weight * 100, 1)}</Td><Td right>{fmtUsd(c.market_value)}</Td><Td right>{fmtNum(c.modified_duration, 2)}</Td><Td right>{fmtUsd(c.dv01)}</Td></tr>
                  ))}
                  <tr className="bg-panel2/50 font-semibold"><Td>Portfolio</Td><Td right>100%</Td><Td right>{fmtUsd(s.interest_rate_risk.market_value)}</Td><Td right>{fmtNum(s.interest_rate_risk.modified_duration, 2)}</Td><Td right>{fmtUsd(s.interest_rate_risk.dv01)}</Td></tr>
                </tbody>
              </DataTable>
              <p className="mt-1 text-xs text-muted">Effective duration {fmtNum(s.interest_rate_risk.effective_duration, 2)}y · convexity {fmtNum(s.interest_rate_risk.convexity, 1)} · cash-flow yield {fmtPct(s.interest_rate_risk.cash_flow_yield_pct, 3)}</p>
            </Section>
            <Section title="Key-rate exposures & scenario P&L">
              <DataTable>
                <thead><tr><Th />{Object.keys(s.key_rate_exposures.krd).map((t) => <Th key={t} right>{t}</Th>)}</tr></thead>
                <tbody>
                  <tr><Td>KRD</Td>{Object.values(s.key_rate_exposures.krd).map((v, i) => <Td key={i} right>{fmtNum(v, 2)}</Td>)}</tr>
                  <tr><Td>P&L</Td>{Object.values(s.scenario_pnl.pnl_by_key_rate).map((v, i) => <Td key={i} right className={pnlClass(v)}>{fmtUsd(v, { d: 0 })}</Td>)}</tr>
                </tbody>
              </DataTable>
              <p className="mt-1 text-sm">
                Scenario P&L (full revaluation): <b className={pnlClass(s.scenario_pnl.pnl_full)}>{fmtUsd(s.scenario_pnl.pnl_full, { signed: true })} ({fmtSignedPct(s.scenario_pnl.return_full * 100)})</b>
              </p>
            </Section>
            <Section title="Main drivers & interpretation"><Bullets items={s.commentary} /></Section>
            <Section title="Portfolio management implications (analytical)"><Bullets items={s.implications} /></Section>
            <Section title="Limitations"><Bullets className="text-muted" items={s.limitations} /></Section>
            <Section title="Sources"><Bullets className="text-muted" items={s.sources} /></Section>
          </article>
        )}
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wider text-accent">{title}</h3>
      {children}
    </section>
  );
}
