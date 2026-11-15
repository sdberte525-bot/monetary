"use client";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useApi, type Provenance } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { fmtBp, fmtNum, fmtPct, fmtSignedPct, fmtUsd, pnlClass } from "@/lib/format";
import { G } from "@/lib/glossary";
import { Metric, PageIntro, SourceLine } from "@/components/common";
import { XYChart } from "@/components/charts";
import {
  Button, Card, CardBody, CardHeader, DataTable, ErrorBox, Field, Input, Loading, Note, Select, Switch, Tabs, TabsContent,
  TabsList, TabsTrigger, Td, Th,
} from "@/components/ui/primitives";

type BondResp = {
  analytics: {
    clean_price: number; dirty_price: number; accrued_per_100: number; accrual_fraction: number; previous_coupon: string;
    next_coupon: string; ytm_pct: number; macaulay_duration: number; modified_duration: number; convexity: number;
    dv01_per_100: number; dv01: number; dollar_duration: number; market_value: number; accrued_amount: number;
    effective_duration_100bp: number;
  };
  cash_flows: { date: string; years: number; amount_per_100: number; amount: number; discount_factor: number; pv_per_100: number; pv_share: number }[];
  approximations: { shock_bp: number; yield: number; full_price: number; full_return: number; duration_return: number; convexity_return: number; duration_price: number; convexity_price: number; duration_error_bp_of_price: number; convexity_error_bp_of_price: number }[];
  price_yield_curve: Record<string, number>[];
  maturity_profile: Record<string, number>[];
  curve_provenance: (Provenance & { curve_as_of: string }) | null;
  conventions: string[];
};

const today = () => new Date().toISOString().slice(0, 10);
const addYears = (iso: string, y: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCFullYear(d.getUTCFullYear() + y);
  return d.toISOString().slice(0, 10);
};

export default function BondPage() {
  const settle0 = today();
  const [f, setF] = useState({
    maturity: addYears(settle0, 10).slice(0, 8) + "15",
    coupon_pct: 4.25,
    frequency: 2,
    day_count: "ACT/ACT-ICMA",
    settlement: settle0,
    mode: "yield",
    ytm_pct: 5.0,
    clean_price: 95,
    face_amount: 1_000_000,
  });
  const [zero, setZero] = useState(false);
  const set = (k: keyof typeof f, v: string | number) => setF((s) => ({ ...s, [k]: v }));
  const body = useMemo(
    () => ({
      ...f,
      coupon_pct: zero ? 0 : Number(f.coupon_pct),
      frequency: zero ? 2 : Number(f.frequency),
      ytm_pct: f.mode === "yield" ? Number(f.ytm_pct) : null,
      clean_price: f.mode === "price" ? Number(f.clean_price) : null,
      face_amount: Number(f.face_amount),
    }),
    [f, zero],
  );
  const r = useApi<BondResp>("/api/bond/analyze", body, 250);
  const a = r.data?.analytics;
  const y = a?.ytm_pct ?? 0;

  return (
    <div className="space-y-3">
      <PageIntro>
        Price and risk any fixed-rate, zero-coupon or Treasury-style bond from an explicit yield, a quoted clean price, or the bootstrapped
        Treasury discount curve. Yields are entered in <b>percent</b> (5.00 = 5.00% = 0.0500 decimal = 500 bp). Every number is computed by the
        Python engine, which is tested against closed-form and textbook benchmarks.
      </PageIntro>
      <Tabs defaultValue="bond">
        <TabsList>
          <TabsTrigger value="bond">Fixed-rate / zero-coupon bond</TabsTrigger>
          <TabsTrigger value="horizon">Total-return decomposition</TabsTrigger>
          <TabsTrigger value="custom">Custom cash flows</TabsTrigger>
        </TabsList>

        <TabsContent value="bond" className="mt-3 space-y-3">
          <Card>
            <CardHeader title="Security definition" subtitle="Street-convention yield; coupon schedule generated backward from maturity (end-of-month rule applied)." />
            <CardBody className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-9">
              <Field label="Settlement">
                <Input type="date" value={f.settlement} onChange={(e) => set("settlement", e.target.value)} />
              </Field>
              <Field label="Maturity">
                <Input type="date" value={f.maturity} onChange={(e) => set("maturity", e.target.value)} />
              </Field>
              <Field label="Coupon (%)">
                <Input type="number" step={0.125} min={0} max={25} disabled={zero} value={zero ? 0 : f.coupon_pct} onChange={(e) => set("coupon_pct", e.target.value)} />
              </Field>
              <Field label="Frequency">
                <Select value={String(f.frequency)} onChange={(v) => set("frequency", Number(v))} options={[{ value: "1", label: "Annual" }, { value: "2", label: "Semiannual" }, { value: "4", label: "Quarterly" }, { value: "12", label: "Monthly" }]} />
              </Field>
              <Field label="Day count">
                <Select value={f.day_count} onChange={(v) => set("day_count", v)} options={["ACT/ACT-ICMA", "30/360", "ACT/360", "ACT/365F"].map((d) => ({ value: d, label: d }))} />
              </Field>
              <Field label="Face amount ($)">
                <Input type="number" step={100000} min={1} value={f.face_amount} onChange={(e) => set("face_amount", e.target.value)} />
              </Field>
              <Field label="Valuation input">
                <Select value={f.mode} onChange={(v) => set("mode", v)} options={[{ value: "yield", label: "Yield to maturity" }, { value: "price", label: "Clean price" }, { value: "curve", label: "Treasury curve (latest)" }]} />
              </Field>
              {f.mode === "yield" && (
                <Field label="YTM (%)" tip={G.ytm}>
                  <Input type="number" step={0.01} value={f.ytm_pct} onChange={(e) => set("ytm_pct", e.target.value)} />
                </Field>
              )}
              {f.mode === "price" && (
                <Field label="Clean price" tip={G.cleanPrice}>
                  <Input type="number" step={0.01} value={f.clean_price} onChange={(e) => set("clean_price", e.target.value)} />
                </Field>
              )}
              {f.mode === "curve" && <Note>Discounted cash-flow by cash-flow on the bootstrapped zero curve; YTM solved from that price.</Note>}
              <div className="flex items-end pb-1">
                <Switch checked={zero} onChange={setZero} label="Zero-coupon" />
              </div>
            </CardBody>
          </Card>

          {r.error && <ErrorBox error={r.error} />}
          {!r.data && !r.error && <Loading />}
          {r.data && a && (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
                <Metric label="Clean price" tip={G.cleanPrice} value={fmtNum(a.clean_price, 4)} sub="per 100 face" />
                <Metric label="Dirty price" tip={G.dirtyPrice} value={fmtNum(a.dirty_price, 4)} sub={`MV ${fmtUsd(a.market_value)}`} />
                <Metric label="Accrued" tip={G.accrued} value={fmtNum(a.accrued_per_100, 4)} sub={`${(a.accrual_fraction * 100).toFixed(1)}% of period · ${fmtUsd(a.accrued_amount, { compact: false })}`} />
                <Metric label="Yield to maturity" tip={G.ytm} value={fmtPct(a.ytm_pct, 4)} sub={`= ${(a.ytm_pct / 100).toFixed(6)} decimal = ${(a.ytm_pct * 100).toFixed(1)} bp`} />
                <Metric label="Macaulay duration" tip={G.macDur} value={`${fmtNum(a.macaulay_duration, 4)}y`} />
                <Metric label="Modified duration" tip={G.modDur} value={`${fmtNum(a.modified_duration, 4)}y`} sub={`Effective (±100bp) ${fmtNum(a.effective_duration_100bp, 4)}`} />
                <Metric label="Convexity" tip={G.convexity} value={fmtNum(a.convexity, 3)} sub="years²" />
                <Metric label="DV01" tip={G.dv01} value={fmtUsd(a.dv01, { compact: false, d: 2 })} sub={`${fmtNum(a.dv01_per_100, 5)} per 100 · $dur ${fmtUsd(a.dollar_duration)}`} />
              </div>
              {r.data.curve_provenance && <SourceLine prov={r.data.curve_provenance} extra={`curve ${r.data.curve_provenance.curve_as_of}`} />}

              <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-2">
                <Card>
                  <CardHeader title="Price vs yield" subtitle="Full repricing vs duration and duration+convexity approximations (clean price)." />
                  <CardBody>
                    <XYChart
                      rows={r.data.price_yield_curve}
                      x="ytm_pct"
                      xLabel="Yield to maturity (%)"
                      yLabel="Clean price"
                      refX={y}
                      series={[
                        { key: "price", label: "Full repricing" },
                        { key: "duration_approx", label: "Duration approx.", dashed: true },
                        { key: "convexity_approx", label: "Duration + convexity", dashed: true, color: "#199e70" },
                      ]}
                      caption="Price per 100 face. Dashed amber line marks the current yield. The curvature gap between the full and duration-only lines is convexity."
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Approximation accuracy" subtitle="ΔP/P ≈ −Dmod·Δy   and   ΔP/P ≈ −Dmod·Δy + ½·C·(Δy)²,   Δy in decimal (100 bp = 0.01)" />
                  <DataTable>
                    <thead>
                      <tr>
                        <Th right>Shock</Th><Th right>New YTM</Th><Th right>Full ΔP/P</Th><Th right>Duration</Th><Th right>Dur.+Cvx</Th>
                        <Th right>Err (dur)</Th><Th right>Err (cvx)</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.data.approximations.map((x) => (
                        <tr key={x.shock_bp} className="hover:bg-panel2/50">
                          <Td right>{fmtBp(x.shock_bp)}</Td>
                          <Td right>{fmtPct(x.yield * 100, 3)}</Td>
                          <Td right className={pnlClass(x.full_return)}>{fmtSignedPct(x.full_return * 100, 3)}</Td>
                          <Td right>{fmtSignedPct(x.duration_return * 100, 3)}</Td>
                          <Td right>{fmtSignedPct(x.convexity_return * 100, 3)}</Td>
                          <Td right className="text-warn">{fmtNum(x.duration_error_bp_of_price, 1)} bp</Td>
                          <Td right className="text-muted">{fmtNum(x.convexity_error_bp_of_price, 2)} bp</Td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                  <div className="p-2 text-[10px] text-muted">Errors are approximation minus full repricing, in bp of price. The duration-only estimate always understates the price of an option-free bond.</div>
                </Card>
              </div>

              <div className="grid gap-3 [&>*]:min-w-0 xl:grid-cols-2">
                <Card>
                  <CardHeader title="Duration vs maturity" subtitle={`Same coupon (${zero ? 0 : f.coupon_pct}%) and yield (${fmtPct(y, 3)}), varying maturity`} />
                  <CardBody>
                    <XYChart
                      rows={r.data.maturity_profile}
                      x="years"
                      xLabel="Maturity (years)"
                      yLabel="Duration (years)"
                      fmtX={(v) => v.toFixed(0)}
                      series={[{ key: "macaulay_duration", label: "Macaulay" }, { key: "modified_duration", label: "Modified" }]}
                      caption="Years. For coupon bonds duration rises with maturity at a decreasing rate; for zeros Macaulay duration equals maturity."
                    />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Convexity vs maturity" />
                  <CardBody>
                    <XYChart
                      rows={r.data.maturity_profile}
                      x="years"
                      xLabel="Maturity (years)"
                      yLabel="Convexity (years²)"
                      fmtX={(v) => v.toFixed(0)}
                      fmtY={(v) => v.toFixed(0)}
                      series={[{ key: "convexity", label: "Convexity", color: "#199e70" }]}
                      caption="Years². Convexity grows roughly with the square of maturity."
                    />
                  </CardBody>
                </Card>
              </div>

              <Card>
                <CardHeader
                  title="Cash-flow schedule"
                  subtitle={`Previous coupon ${a.previous_coupon} · next coupon ${a.next_coupon} · discounting at YTM with compounding at the coupon frequency`}
                  right={
                    <Button size="sm" onClick={() => downloadCsv(r.data!.cash_flows, "bond_cash_flows.csv")}>
                      <Download className="h-3 w-3" /> CSV
                    </Button>
                  }
                />
                <div className="max-h-80 overflow-y-auto">
                  <DataTable>
                    <thead>
                      <tr><Th>Date</Th><Th right>t (years)</Th><Th right>Cash flow /100</Th><Th right>Cash flow ($)</Th><Th right>DF</Th><Th right>PV /100</Th><Th right>% of price</Th></tr>
                    </thead>
                    <tbody>
                      {r.data.cash_flows.map((c) => (
                        <tr key={c.date} className="hover:bg-panel2/50">
                          <Td>{c.date}</Td>
                          <Td right>{fmtNum(c.years, 4)}</Td>
                          <Td right>{fmtNum(c.amount_per_100, 4)}</Td>
                          <Td right>{fmtUsd(c.amount, { compact: false, d: 2 })}</Td>
                          <Td right>{c.discount_factor.toFixed(6)}</Td>
                          <Td right>{fmtNum(c.pv_per_100, 4)}</Td>
                          <Td right>{fmtPct(c.pv_share * 100, 2)}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </DataTable>
                </div>
                <div className="p-2">
                  {r.data.conventions.map((c) => (
                    <div key={c} className="text-[10px] text-muted">• {c}</div>
                  ))}
                </div>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="horizon" className="mt-3">
          <HorizonTab />
        </TabsContent>
        <TabsContent value="custom" className="mt-3">
          <CustomFlowsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function HorizonTab() {
  const s = today();
  const [f, setF] = useState({ maturity: addYears(s, 10), coupon_pct: 4.5, settlement: s, horizon_date: addYears(s, 1), ytm_start_pct: 5.0, ytm_end_pct: 4.5, reinvest_pct: "" });
  const body = { ...f, coupon_pct: Number(f.coupon_pct), ytm_start_pct: Number(f.ytm_start_pct), ytm_end_pct: Number(f.ytm_end_pct), reinvest_pct: f.reinvest_pct === "" ? null : Number(f.reinvest_pct), frequency: 2, day_count: "ACT/ACT-ICMA" };
  const r = useApi<{ initial_dirty: number; final_dirty: number; coupons_received: number; reinvestment_income: number; accrued_change: number; accretion_rolldown: number; rate_effect: number; total: number; total_return: number; identity: string }>("/api/bond/horizon", body, 250);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  return (
    <Card>
      <CardHeader title="Horizon total-return decomposition" subtitle="Per 100 face, semiannual Treasury-style bond. The identity holds exactly." />
      <CardBody className="space-y-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-7">
          <Field label="Settlement"><Input type="date" value={f.settlement} onChange={(e) => set("settlement", e.target.value)} /></Field>
          <Field label="Horizon"><Input type="date" value={f.horizon_date} onChange={(e) => set("horizon_date", e.target.value)} /></Field>
          <Field label="Maturity"><Input type="date" value={f.maturity} onChange={(e) => set("maturity", e.target.value)} /></Field>
          <Field label="Coupon (%)"><Input type="number" step={0.125} value={f.coupon_pct} onChange={(e) => set("coupon_pct", e.target.value)} /></Field>
          <Field label="YTM today (%)"><Input type="number" step={0.01} value={f.ytm_start_pct} onChange={(e) => set("ytm_start_pct", e.target.value)} /></Field>
          <Field label="YTM at horizon (%)"><Input type="number" step={0.01} value={f.ytm_end_pct} onChange={(e) => set("ytm_end_pct", e.target.value)} /></Field>
          <Field label="Reinvest rate (%)" tip="Coupons received before the horizon earn simple interest at this rate. Blank = today's YTM."><Input type="number" step={0.01} placeholder="= YTM" value={f.reinvest_pct} onChange={(e) => set("reinvest_pct", e.target.value)} /></Field>
        </div>
        {r.error && <ErrorBox error={r.error} />}
        {r.data && (
          <DataTable>
            <thead><tr><Th>Component</Th><Th right>Per 100 face</Th><Th right>% of initial dirty price</Th></tr></thead>
            <tbody>
              {([
                ["Coupons received", r.data.coupons_received],
                ["Reinvestment income", r.data.reinvestment_income],
                ["Change in accrued interest", r.data.accrued_change],
                ["Accretion / roll-down (clean price change at constant yield)", r.data.accretion_rolldown],
                ["Rate effect (clean price change from yield change at horizon)", r.data.rate_effect],
              ] as [string, number][]).map(([k, v]) => (
                <tr key={k}><Td>{k}</Td><Td right className={pnlClass(v)}>{fmtNum(v, 4)}</Td><Td right>{fmtSignedPct((v / r.data!.initial_dirty) * 100, 3)}</Td></tr>
              ))}
              <tr className="bg-panel2/50 font-semibold"><Td>Total return</Td><Td right className={pnlClass(r.data.total)}>{fmtNum(r.data.total, 4)}</Td><Td right className={pnlClass(r.data.total)}>{fmtSignedPct(r.data.total_return * 100, 3)}</Td></tr>
            </tbody>
          </DataTable>
        )}
        {r.data && <Note>{r.data.identity}. Initial dirty {fmtNum(r.data.initial_dirty, 4)} → final dirty {fmtNum(r.data.final_dirty, 4)}. Horizon return is not annualized.</Note>}
      </CardBody>
    </Card>
  );
}

function CustomFlowsTab() {
  const s = today();
  const [text, setText] = useState(`${addYears(s, 1)},5\n${addYears(s, 2)},5\n${addYears(s, 3)},105`);
  const [comp, setComp] = useState("2");
  const [mode, setMode] = useState("yield");
  const [ytm, setYtm] = useState(5);
  const [price, setPrice] = useState(100);
  const parsed = useMemo(() => {
    const flows = text.split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => l.split(",").map((x) => x.trim()));
    if (!flows.length || flows.some((x) => x.length !== 2 || !/^\d{4}-\d{2}-\d{2}$/.test(x[0]) || !Number.isFinite(Number(x[1])))) return null;
    return flows.map(([date, amount]) => ({ date, amount: Number(amount) }));
  }, [text]);
  const body = parsed ? { settlement: s, flows: parsed, compounding: comp, mode, ytm_pct: mode === "yield" ? ytm : null, price: mode === "price" ? price : null } : undefined;
  const r = useApi<{ price: number; ytm_pct: number; macaulay_duration: number; modified_duration: number; convexity: number; dv01: number; convention: string }>(parsed ? "/api/bond/custom" : null, body, 300);
  return (
    <Card>
      <CardHeader title="Custom cash flows" subtitle={`Settlement ${s}. One flow per line: YYYY-MM-DD,amount. Flows on or before settlement are ignored.`} />
      <CardBody className="grid gap-3 [&>*]:min-w-0 lg:grid-cols-2">
        <div className="space-y-2">
          <textarea aria-label="Cash flows" value={text} onChange={(e) => setText(e.target.value)} rows={8} className="num w-full rounded border border-border bg-bg p-2 text-xs text-fg focus:border-accent focus:outline-none" />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Compounding"><Select value={comp} onChange={setComp} options={[{ value: "1", label: "Annual" }, { value: "2", label: "Semiannual" }, { value: "4", label: "Quarterly" }, { value: "12", label: "Monthly" }, { value: "continuous", label: "Continuous" }]} /></Field>
            <Field label="Input"><Select value={mode} onChange={setMode} options={[{ value: "yield", label: "Yield" }, { value: "price", label: "Price" }, { value: "curve", label: "Treasury curve" }]} /></Field>
            {mode === "yield" && <Field label="Yield (%)"><Input type="number" step={0.01} value={ytm} onChange={(e) => setYtm(Number(e.target.value))} /></Field>}
            {mode === "price" && <Field label="Price (PV)"><Input type="number" step={0.01} value={price} onChange={(e) => setPrice(Number(e.target.value))} /></Field>}
          </div>
          {!parsed && <Note tone="warn">Each line must be YYYY-MM-DD,amount.</Note>}
        </div>
        <div>
          {r.error && <ErrorBox error={r.error} />}
          {r.data && (
            <div className="grid grid-cols-2 gap-2">
              <Metric label="Present value" tip="Σ CF × DF(y, t)" value={fmtNum(r.data.price, 4)} />
              <Metric label="Yield" tip={G.ytm} value={fmtPct(r.data.ytm_pct, 4)} />
              <Metric label="Macaulay duration" tip={G.macDur} value={`${fmtNum(r.data.macaulay_duration, 4)}y`} />
              <Metric label="Modified duration" tip={G.modDur} value={`${fmtNum(r.data.modified_duration, 4)}y`} />
              <Metric label="Convexity" tip={G.convexity} value={fmtNum(r.data.convexity, 3)} />
              <Metric label="DV01 (per unit PV basis)" tip={G.dv01} value={fmtNum(r.data.dv01, 5)} />
              <div className="col-span-2"><Note>{r.data.convention}</Note></div>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
