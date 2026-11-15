export const fmtPct = (v: number | null | undefined, d = 2) => (v == null || !isFinite(v) ? "—" : `${v.toFixed(d)}%`);
/** Values that round to zero at the displayed precision are shown unsigned (no "-0.00"). */
const unsignZero = (v: number, d: number) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v);
export const fmtNum = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? "—" : unsignZero(v, d).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
export const fmtBp = (v: number | null | undefined, d = 0, signed = true) =>
  v == null || !isFinite(v) ? "—" : `${signed && v > 0 ? "+" : ""}${v.toFixed(d)} bp`;
export const fmtSignedPct = (v: number | null | undefined, d = 2) =>
  v == null || !isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`;

export function fmtUsd(v: number | null | undefined, opts: { compact?: boolean; signed?: boolean; d?: number } = {}) {
  if (v == null || !isFinite(v)) return "—";
  const { compact = true, signed = false, d } = opts;
  if (Math.abs(v) < 0.5) v = 0;
  const sign = v < 0 ? "−" : signed && v > 0 ? "+" : "";
  const a = Math.abs(v);
  if (compact) {
    if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(d ?? 2)}bn`;
    if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(d ?? 2)}mm`;
    if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(d ?? 1)}k`;
  }
  return `${sign}$${a.toLocaleString("en-US", { maximumFractionDigits: d ?? 0, minimumFractionDigits: d ?? 0 })}`;
}

export const pnlClass = (v: number | null | undefined) => (v == null || Math.abs(v) < 1e-9 ? "text-fg" : v > 0 ? "text-pos" : "text-neg");

export const titleCase = (s: string | null | undefined) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : "—");
