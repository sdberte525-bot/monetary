import type { Position } from "./api";

export function toCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  if (!rows.length) return "";
  const cols = columns ?? Object.keys(rows[0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toPrecision(12)) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
}

export function downloadText(text: string, filename: string, mime = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(rows: Record<string, unknown>[], filename: string, columns?: string[]) {
  downloadText(toCsv(rows, columns), filename);
}

function parseLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export const POSITION_COLUMNS = ["id", "label", "coupon_pct", "maturity", "face_amount", "frequency", "day_count"];

/** Parse a portfolio CSV. Required: label, coupon_pct, maturity (YYYY-MM-DD), face_amount. Returns errors per row. */
export function parsePositionsCsv(text: string): { positions: Position[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const errors: string[] = [];
  if (lines.length < 2) return { positions: [], errors: ["CSV needs a header row and at least one position"] };
  const header = parseLine(lines[0]).map((h) => h.toLowerCase());
  for (const req of ["label", "coupon_pct", "maturity", "face_amount"])
    if (!header.includes(req)) errors.push(`missing required column '${req}'`);
  if (errors.length) return { positions: [], errors };
  const idx = (k: string) => header.indexOf(k);
  const positions: Position[] = [];
  lines.slice(1).forEach((line, i) => {
    const c = parseLine(line);
    const row = i + 2;
    const coupon = Number(c[idx("coupon_pct")]);
    const face = Number(c[idx("face_amount")]);
    const mat = c[idx("maturity")];
    const freq = idx("frequency") >= 0 && c[idx("frequency")] ? Number(c[idx("frequency")]) : 2;
    const dc = (idx("day_count") >= 0 && c[idx("day_count")]) || "ACT/ACT-ICMA";
    if (!isFinite(coupon) || coupon < 0 || coupon > 25) return errors.push(`row ${row}: coupon_pct must be 0–25 (percent)`);
    if (!isFinite(face) || face <= 0) return errors.push(`row ${row}: face_amount must be positive`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(mat) || isNaN(Date.parse(mat))) return errors.push(`row ${row}: maturity must be YYYY-MM-DD`);
    if (![1, 2, 4, 12].includes(freq)) return errors.push(`row ${row}: frequency must be 1, 2, 4 or 12`);
    if (!["ACT/ACT-ICMA", "30/360", "ACT/360", "ACT/365F"].includes(dc)) return errors.push(`row ${row}: unknown day_count`);
    positions.push({
      id: (idx("id") >= 0 && c[idx("id")]) || `P${row}-${Math.random().toString(36).slice(2, 6)}`,
      label: c[idx("label")] || `Position ${row}`,
      coupon_pct: coupon,
      maturity: mat,
      face_amount: face,
      frequency: freq as Position["frequency"],
      day_count: dc as Position["day_count"],
    });
  });
  const ids = positions.map((p) => p.id);
  if (new Set(ids).size !== ids.length) errors.push("duplicate ids in CSV");
  return { positions, errors };
}
