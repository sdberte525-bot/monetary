"use client";
import { useEffect, useState } from "react";
import { RotateCcw, Save, Trash2 } from "lucide-react";
import { apiFetch, TENORS, useApi } from "@/lib/api";
import { useSavedList } from "@/lib/portfolio-store";
import { Button, Field, Input, Select, Slider } from "@/components/ui/primitives";

export type Shocks = Record<string, number>;
export const ZERO_SHOCKS: Shocks = Object.fromEntries(TENORS.map((t) => [t, 0]));

type Presets = { presets: Record<string, { label: string; anchors: Record<string, number> }>; definitions: Record<string, string> };

/** Builds a tenor-by-tenor shock vector (bp). Presets are generated server-side so formulas are single-sourced. */
export function ShockEditor({ value, onChange, initialParallel = 0 }: { value: Shocks; onChange: (s: Shocks) => void; initialParallel?: number }) {
  const presets = useApi<Presets>("/api/scenarios/presets");
  const [mode, setMode] = useState("parallel");
  const [mag, setMag] = useState(initialParallel);
  const [preset, setPreset] = useState("bull_steepener");
  const [scale, setScale] = useState(1);
  const saved = useSavedList<{ name: string; shocks: Shocks }>("monetary.scenarios.v1");
  const [name, setName] = useState("");

  useEffect(() => {
    if (mode === "custom") return;
    const body = mode === "parallel" ? { kind: "parallel", bp: mag } : { kind: "preset", preset, scale };
    let live = true;
    apiFetch<{ shocks_bp: Shocks }>("/api/scenarios/shape", { json: body })
      .then((r) => live && onChange(r.shocks_bp))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, mag, preset, scale]);

  const presetOpts = presets.data
    ? Object.entries(presets.data.presets).map(([k, v]) => ({ value: k, label: v.label }))
    : [{ value: preset, label: "Loading…" }];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Shock type">
          <Select
            value={mode}
            onChange={setMode}
            options={[
              { value: "parallel", label: "Parallel shift" },
              { value: "preset", label: "Curve-shape preset" },
              { value: "custom", label: "Custom by maturity" },
            ]}
          />
        </Field>
        {mode === "parallel" && (
          <Field label={`Parallel shift: ${mag > 0 ? "+" : ""}${mag} bp`}>
            <Slider value={mag} min={-300} max={300} step={5} onChange={setMag} ariaLabel="Parallel shift in basis points" />
          </Field>
        )}
        {mode === "preset" && (
          <Field label={`Scale × ${scale.toFixed(2)}`} tip="Multiplies every anchor shock of the preset.">
            <Slider value={scale} min={-3} max={3} step={0.25} onChange={setScale} ariaLabel="Preset scale" />
          </Field>
        )}
      </div>
      {mode === "preset" && (
        <Field label="Preset (anchors interpolated linearly in maturity, flat outside)">
          <Select value={preset} onChange={setPreset} options={presetOpts} />
        </Field>
      )}
      <div>
        <div className="mb-1 text-2xs font-medium uppercase tracking-wide text-muted">
          Shock by tenor (bp){mode !== "custom" && " — edit any value to switch to custom"}
        </div>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 lg:grid-cols-11">
          {TENORS.map((t) => (
            <label key={t} className="flex flex-col items-center gap-0.5">
              <span className="text-[10px] text-muted">{t}</span>
              <Input
                type="number"
                step={1}
                aria-label={`${t} shock in basis points`}
                className="px-1 text-center"
                value={Number.isFinite(value[t]) ? Math.round((value[t] ?? 0) * 100) / 100 : 0}
                onChange={(e) => {
                  setMode("custom");
                  const v = Number(e.target.value);
                  onChange({ ...value, [t]: Number.isFinite(v) ? Math.max(-1000, Math.min(1000, v)) : 0 });
                }}
              />
            </label>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button
          size="sm"
          onClick={() => {
            setMode("parallel");
            setMag(0);
            setScale(1);
            onChange({ ...ZERO_SHOCKS });
          }}
        >
          <RotateCcw className="h-3 w-3" /> Reset scenario
        </Button>
        <Input placeholder="Scenario name" value={name} onChange={(e) => setName(e.target.value)} className="h-7 w-40 font-sans" />
        <Button
          size="sm"
          disabled={!name.trim()}
          onClick={() => {
            saved.save({ name: name.trim(), shocks: value });
            setName("");
          }}
        >
          <Save className="h-3 w-3" /> Save
        </Button>
        {saved.items.length > 0 && (
          <div className="flex items-center gap-1">
            <Select
              ariaLabel="Load saved scenario"
              value=""
              onChange={(n) => {
                const s = saved.items.find((i) => i.name === n);
                if (s) {
                  setMode("custom");
                  onChange({ ...ZERO_SHOCKS, ...s.shocks });
                }
              }}
              options={[{ value: "", label: "Load saved…" }, ...saved.items.map((i) => ({ value: i.name, label: i.name }))]}
            />
            <Select
              ariaLabel="Delete saved scenario"
              value=""
              onChange={(n) => n && saved.remove(n)}
              options={[{ value: "", label: "Delete…" }, ...saved.items.map((i) => ({ value: i.name, label: i.name }))]}
            />
            <Trash2 className="h-3 w-3 text-muted" />
          </div>
        )}
      </div>
    </div>
  );
}
