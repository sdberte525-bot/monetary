"use client";
import {
  Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { TENORS } from "@/lib/api";
import { fmtUsd } from "@/lib/format";

/** Validated dark-mode categorical order (fixed, never cycled). */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500"];
export const POS = "#22c55e";
export const NEG = "#e66767";
const GRID = "#1f2f45";
const AXIS = "#8b9bb0";

type TipRow = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number; payload?: Record<string, unknown> };

function TooltipBox({
  active,
  payload,
  label,
  fmt,
  labelFmt,
}: {
  active?: boolean;
  payload?: TipRow[];
  label?: string | number;
  fmt: (v: number, key?: string) => string;
  labelFmt?: (l: string | number) => string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded border border-border bg-[#0a1322]/95 px-2.5 py-1.5 text-xs shadow-xl">
      <div className="mb-1 font-semibold text-fg">{labelFmt ? labelFmt(label ?? "") : label}</div>
      {payload
        .filter((p) => p.value != null && !(p.dataKey as string)?.startsWith("_"))
        .map((p, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />
            <span className="text-muted">{p.name}</span>
            <span className="num ml-auto pl-3 text-fg">{fmt(Number(p.value), String(p.dataKey))}</span>
          </div>
        ))}
    </div>
  );
}

export function ChartFrame({
  children,
  caption,
  height = 260,
}: {
  children: React.ReactNode;
  caption?: React.ReactNode;
  height?: number;
}) {
  return (
    <figure className="w-full">
      <div style={{ height }} className="w-full">
        {children}
      </div>
      {caption && <figcaption className="mt-1 text-[10px] text-muted">{caption}</figcaption>}
    </figure>
  );
}

const axisProps = { stroke: AXIS, tick: { fill: AXIS, fontSize: 11 }, tickLine: false, axisLine: { stroke: GRID } };

export type CurveSeries = { key: string; label: string; values: Record<string, number | null | undefined>; dashed?: boolean; color?: string };

/** Yield curve(s) on an evenly spaced tenor axis. */
export function TenorCurveChart({
  series,
  height = 260,
  unit = "%",
  yLabel = "Yield (%)",
  caption,
  decimals = 2,
}: {
  series: CurveSeries[];
  height?: number;
  unit?: string;
  yLabel?: string;
  caption?: React.ReactNode;
  decimals?: number;
}) {
  const data = TENORS.map((t) => {
    const row: Record<string, string | number | null> = { tenor: t };
    series.forEach((s) => (row[s.key] = s.values[t] ?? null));
    return row;
  });
  return (
    <ChartFrame height={height} caption={caption}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="tenor" {...axisProps} label={{ value: "Maturity", position: "insideBottom", offset: -10, fill: AXIS, fontSize: 11 }} />
          <YAxis
            {...axisProps}
            domain={["auto", "auto"]}
            width={52}
            tickFormatter={(v: number) => v.toFixed(decimals > 1 ? 1 : decimals)}
            label={{ value: yLabel, angle: -90, position: "insideLeft", fill: AXIS, fontSize: 11, dy: 30 }}
          />
          <Tooltip content={<TooltipBox fmt={(v) => `${v.toFixed(decimals)}${unit}`} />} />
          {series.length > 1 && <Legend itemSorter={null} verticalAlign="top" height={22} iconType="plainline" />}
          {series.map((s, i) => (
            <Line
              key={s.key}
              type="linear"
              dataKey={s.key}
              name={s.label}
              stroke={s.color ?? SERIES[i % SERIES.length]}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              dot={{ r: 3, strokeWidth: 0, fill: s.color ?? SERIES[i % SERIES.length] }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Bars by tenor (bp shocks, key-rate durations, KR-DV01). One or two series. */
export function TenorBarChart({
  series,
  height = 220,
  fmt,
  yLabel,
  caption,
  signColors = false,
}: {
  series: { key: string; label: string; values: Record<string, number | null | undefined> }[];
  height?: number;
  fmt: (v: number) => string;
  yLabel: string;
  caption?: React.ReactNode;
  signColors?: boolean;
}) {
  const data = TENORS.map((t) => {
    const row: Record<string, string | number | null> = { tenor: t };
    series.forEach((s) => (row[s.key] = s.values[t] ?? null));
    return row;
  });
  return (
    <ChartFrame height={height} caption={caption}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 4, bottom: 18 }} barGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="tenor" {...axisProps} label={{ value: "Tenor", position: "insideBottom", offset: -10, fill: AXIS, fontSize: 11 }} />
          <YAxis {...axisProps} width={58} tickFormatter={(v: number) => fmt(v)} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: AXIS, fontSize: 11, dy: 40 }} />
          <ReferenceLine y={0} stroke={AXIS} strokeOpacity={0.6} />
          <Tooltip cursor={{ fill: "#ffffff08" }} content={<TooltipBox fmt={(v) => fmt(v)} />} />
          {series.length > 1 && <Legend itemSorter={null} verticalAlign="top" height={22} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[3, 3, 0, 0]} maxBarSize={28} isAnimationActive={false}>
              {signColors &&
                data.map((d, j) => <Cell key={j} fill={(Number(d[s.key]) || 0) >= 0 ? POS : NEG} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Waterfall of P&L contributions from 0 to the total (green gains, red losses). */
export function WaterfallChart({
  items,
  height = 260,
  caption,
}: {
  items: { label: string; value: number }[];
  height?: number;
  caption?: React.ReactNode;
}) {
  let run = 0;
  const data = items.map((it) => {
    const start = run;
    run += it.value;
    return { label: it.label, _base: Math.min(start, run), delta: Math.abs(it.value), value: it.value, kind: it.value >= 0 ? "pos" : "neg" };
  });
  data.push({ label: "Total P&L", _base: Math.min(0, run), delta: Math.abs(run), value: run, kind: "total" });
  return (
    <ChartFrame height={height} caption={caption}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 40 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" {...axisProps} interval={0} angle={-25} textAnchor="end" height={56} tick={{ fill: AXIS, fontSize: 10 }} />
          <YAxis {...axisProps} width={64} tickFormatter={(v: number) => fmtUsd(v, { d: 1 })} label={{ value: "P&L (USD)", angle: -90, position: "insideLeft", fill: AXIS, fontSize: 11, dy: 30 }} />
          <ReferenceLine y={0} stroke={AXIS} strokeOpacity={0.6} />
          <Tooltip
            cursor={{ fill: "#ffffff08" }}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <div className="rounded border border-border bg-[#0a1322]/95 px-2.5 py-1.5 text-xs">
                  <div className="font-semibold">{label}</div>
                  <div className="num">{fmtUsd(Number((payload[0].payload as { value: number }).value), { signed: true, compact: false })}</div>
                </div>
              ) : null
            }
          />
          <Bar dataKey="_base" stackId="w" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="delta" stackId="w" radius={[2, 2, 2, 2]} maxBarSize={40} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.kind === "total" ? SERIES[0] : d.kind === "pos" ? POS : NEG} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Date-indexed lines (one y-axis only). */
export function TimeSeriesChart({
  rows,
  series,
  height = 260,
  yLabel,
  fmt = (v) => v.toFixed(2),
  caption,
  refLines,
  zeroLine,
}: {
  rows: Record<string, unknown>[];
  series: { key: string; label: string; color?: string }[];
  height?: number;
  yLabel: string;
  fmt?: (v: number) => string;
  caption?: React.ReactNode;
  refLines?: { x: string; label: string }[];
  zeroLine?: boolean;
}) {
  return (
    <ChartFrame height={height} caption={caption}>
      <ResponsiveContainer>
        <LineChart data={rows} margin={{ top: 8, right: 16, left: 4, bottom: 8 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" {...axisProps} minTickGap={48} tickFormatter={(d: string) => d.slice(0, 7)} />
          <YAxis {...axisProps} width={52} domain={["auto", "auto"]} tickFormatter={(v: number) => fmt(v)} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: AXIS, fontSize: 11, dy: 30 }} />
          {zeroLine && <ReferenceLine y={0} stroke={AXIS} strokeOpacity={0.6} />}
          {refLines?.map((r) => (
            <ReferenceLine key={r.x + r.label} x={r.x} stroke="#c98500" strokeDasharray="3 3" label={{ value: r.label, fill: "#c98500", fontSize: 10, position: "insideTopLeft" }} />
          ))}
          <Tooltip content={<TooltipBox fmt={(v) => fmt(v)} />} />
          {series.length > 1 && <Legend itemSorter={null} verticalAlign="top" height={22} iconType="plainline" />}
          {series.map((s, i) => (
            <Line key={s.key} type="linear" dataKey={s.key} name={s.label} stroke={s.color ?? SERIES[i % SERIES.length]} strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Numeric x-axis line chart (e.g. price vs yield, duration vs maturity). */
export function XYChart({
  rows,
  x,
  series,
  xLabel,
  yLabel,
  height = 260,
  fmtX = (v) => v.toFixed(2),
  fmtY = (v) => v.toFixed(2),
  caption,
  refX,
}: {
  rows: Record<string, number | null>[];
  x: string;
  series: { key: string; label: string; dashed?: boolean; color?: string }[];
  xLabel: string;
  yLabel: string;
  height?: number;
  fmtX?: (v: number) => string;
  fmtY?: (v: number) => string;
  caption?: React.ReactNode;
  refX?: number;
}) {
  return (
    <ChartFrame height={height} caption={caption}>
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 4, bottom: 18 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey={x} type="number" domain={["dataMin", "dataMax"]} {...axisProps} tickFormatter={fmtX} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: AXIS, fontSize: 11 }} />
          <YAxis {...axisProps} width={56} domain={["auto", "auto"]} tickFormatter={fmtY} label={{ value: yLabel, angle: -90, position: "insideLeft", fill: AXIS, fontSize: 11, dy: 30 }} />
          {refX != null && <ReferenceLine x={refX} stroke="#c98500" strokeDasharray="3 3" />}
          <Tooltip content={<TooltipBox fmt={(v) => fmtY(v)} labelFmt={(l) => `${xLabel}: ${fmtX(Number(l))}`} />} />
          {series.length > 1 && <Legend itemSorter={null} verticalAlign="top" height={22} iconType="plainline" />}
          {series.map((s, i) => (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color ?? SERIES[i % SERIES.length]} strokeWidth={2} strokeDasharray={s.dashed ? "5 4" : undefined} dot={false} isAnimationActive={false} />
          ))}
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Horizontal bars per category with optional sign coloring (P&L by security, contributions). */
export function CategoryBarChart({
  rows,
  height = 240,
  fmt,
  xLabel,
  signColors = false,
  caption,
  series,
}: {
  rows: Record<string, string | number>[];
  series: { key: string; label: string }[];
  height?: number;
  fmt: (v: number) => string;
  xLabel: string;
  signColors?: boolean;
  caption?: React.ReactNode;
}) {
  return (
    <ChartFrame height={height} caption={caption}>
      <ResponsiveContainer>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 18 }} barGap={2}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" {...axisProps} tickFormatter={(v: number) => fmt(v)} label={{ value: xLabel, position: "insideBottom", offset: -10, fill: AXIS, fontSize: 11 }} />
          <YAxis type="category" dataKey="name" {...axisProps} width={150} tick={{ fill: AXIS, fontSize: 10 }} />
          <ReferenceLine x={0} stroke={AXIS} strokeOpacity={0.6} />
          <Tooltip cursor={{ fill: "#ffffff08" }} content={<TooltipBox fmt={(v) => fmt(v)} />} />
          {series.length > 1 && <Legend itemSorter={null} verticalAlign="top" height={22} />}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={SERIES[i]} radius={[0, 3, 3, 0]} maxBarSize={18} isAnimationActive={false}>
              {signColors && rows.map((r, j) => <Cell key={j} fill={Number(r[s.key]) >= 0 ? POS : NEG} />)}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

/** Stacked component bars by tenor with a total line (yield-shock decomposition). */
export function DecompositionChart({
  rows,
  components,
  height = 240,
  caption,
}: {
  rows: Record<string, number | string>[];
  components: { key: string; label: string }[];
  height?: number;
  caption?: React.ReactNode;
}) {
  return (
    <ChartFrame height={height} caption={caption}>
      <ResponsiveContainer>
        <ComposedChart data={rows} stackOffset="sign" margin={{ top: 8, right: 12, left: 4, bottom: 18 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="tenor" {...axisProps} label={{ value: "Tenor", position: "insideBottom", offset: -10, fill: AXIS, fontSize: 11 }} />
          <YAxis {...axisProps} width={52} tickFormatter={(v: number) => v.toFixed(0)} label={{ value: "Yield change (bp)", angle: -90, position: "insideLeft", fill: AXIS, fontSize: 11, dy: 50 }} />
          <ReferenceLine y={0} stroke={AXIS} strokeOpacity={0.6} />
          <Tooltip cursor={{ fill: "#ffffff08" }} content={<TooltipBox fmt={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)} bp`} />} />
          <Legend itemSorter={null} verticalAlign="top" height={40} />
          {components.map((c, i) => (
            <Bar key={c.key} dataKey={c.key} name={c.label} stackId="s" fill={SERIES[i]} maxBarSize={30} isAnimationActive={false} stroke="#0f1b2d" strokeWidth={1} />
          ))}
          <Line dataKey="total" name="Total shock" stroke="#e8edf3" strokeWidth={2} dot={{ r: 3, fill: "#e8edf3", strokeWidth: 0 }} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
