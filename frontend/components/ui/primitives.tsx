"use client";
/* shadcn/ui-style primitives (Radix + Tailwind + cva), adapted to the terminal theme. */
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as SliderPrimitive from "@radix-ui/react-slider";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/* ----------------------------------------------------------------- Button */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:bg-accent/85",
        outline: "border border-border bg-panel2 text-fg hover:bg-border/60",
        ghost: "text-muted hover:bg-panel2 hover:text-fg",
        danger: "border border-neg/40 text-neg hover:bg-neg/10",
      },
      size: { sm: "h-7 px-2.5", md: "h-8 px-3", icon: "h-7 w-7" },
    },
    defaultVariants: { variant: "outline", size: "md" },
  },
);
export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...p }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...p} />
));
Button.displayName = "Button";

/* ----------------------------------------------------------------- Card */
export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <section className={cn("min-w-0 rounded-md border border-border bg-panel", className)} {...p} />;
}
export function CardHeader({
  title,
  subtitle,
  right,
  tip,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  right?: React.ReactNode;
  tip?: string;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-2 border-b border-border px-3 py-2", className)}>
      <div className="min-w-0">
        <h2 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-fg">
          {title}
          {tip && <InfoTip text={tip} />}
        </h2>
        {subtitle && <p className="mt-0.5 text-2xs text-muted">{subtitle}</p>}
      </div>
      {right && <div className="flex flex-wrap items-center gap-1.5">{right}</div>}
    </header>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-3", className)} {...p} />;
}

/* ----------------------------------------------------------------- Badge */
const badgeVariants = cva("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide", {
  variants: {
    tone: {
      neutral: "bg-panel2 text-muted border border-border",
      live: "bg-pos/15 text-pos border border-pos/30",
      snapshot: "bg-warn/15 text-warn border border-warn/30",
      user: "bg-accent/15 text-accent border border-accent/30",
      warn: "bg-warn/15 text-warn border border-warn/30",
      neg: "bg-neg/15 text-neg border border-neg/30",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({
  tone,
  className,
  ...p
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}

/* ----------------------------------------------------------------- Tooltip */
export const TooltipProvider = TooltipPrimitive.Provider;
export function Tip({ content, children }: { content: React.ReactNode; children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Root delayDuration={150}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={5}
          className="z-50 max-w-xs rounded border border-border bg-[#0a1322] px-2.5 py-1.5 text-xs leading-snug text-fg shadow-xl"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-[#0a1322]" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
export function InfoTip({ text }: { text: React.ReactNode }) {
  return (
    <Tip content={text}>
      <button type="button" aria-label="Explanation" className="text-muted hover:text-fg">
        <Info className="h-3 w-3" />
      </button>
    </Tip>
  );
}

/* ----------------------------------------------------------------- Inputs */
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...p }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-7 w-full rounded border border-border bg-bg px-2 text-xs text-fg num placeholder:text-muted focus:border-accent focus:outline-none disabled:opacity-50",
        className,
      )}
      {...p}
    />
  ),
);
Input.displayName = "Input";

export function Select({
  value,
  onChange,
  options,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn("h-7 rounded border border-border bg-bg px-1.5 text-xs text-fg focus:border-accent focus:outline-none", className)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, tip, children, className }: { label: string; tip?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1", className)}>
      <span className="flex items-center gap-1 text-2xs font-medium uppercase tracking-wide text-muted">
        {label}
        {tip && <InfoTip text={tip} />}
      </span>
      {children}
    </label>
  );
}

/* ----------------------------------------------------------------- Slider */
export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  ariaLabel?: string;
}) {
  return (
    <SliderPrimitive.Root
      className="relative flex h-5 w-full touch-none select-none items-center"
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onChange(v[0])}
      aria-label={ariaLabel}
    >
      <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-border">
        <SliderPrimitive.Range className="absolute h-full bg-accent" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        aria-label={ariaLabel}
        className="block h-3.5 w-3.5 rounded-full border-2 border-accent bg-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      />
    </SliderPrimitive.Root>
  );
}

/* ----------------------------------------------------------------- Switch */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-fg">
      <SwitchPrimitive.Root
        checked={checked}
        onCheckedChange={onChange}
        className="relative h-4 w-7 rounded-full bg-border data-[state=checked]:bg-accent"
      >
        <SwitchPrimitive.Thumb className="block h-3 w-3 translate-x-0.5 rounded-full bg-fg transition-transform data-[state=checked]:translate-x-3.5" />
      </SwitchPrimitive.Root>
      {label}
    </label>
  );
}

/* ----------------------------------------------------------------- Tabs */
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex gap-0.5 rounded border border-border bg-bg p-0.5", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "rounded px-2.5 py-1 text-xs font-medium text-muted data-[state=active]:bg-panel2 data-[state=active]:text-fg",
        className,
      )}
      {...p}
    />
  );
}
export const TabsContent = TabsPrimitive.Content;

/* ----------------------------------------------------------------- Table */
export function DataTable({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn("w-full border-collapse text-xs", className)} {...p} />
    </div>
  );
}
export function Th({ className, right, ...p }: React.ThHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return (
    <th
      className={cn(
        "whitespace-nowrap border-b border-border bg-panel2 px-2 py-1.5 text-2xs font-semibold uppercase tracking-wide text-muted",
        right ? "text-right" : "text-left",
        className,
      )}
      {...p}
    />
  );
}
export function Td({ className, right, ...p }: React.TdHTMLAttributes<HTMLTableCellElement> & { right?: boolean }) {
  return <td className={cn("whitespace-nowrap border-b border-border/60 px-2 py-1", right && "text-right num", className)} {...p} />;
}

/* ----------------------------------------------------------------- States */
export function Loading({ label = "Computing" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-xs text-muted" role="status">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-border border-t-accent" />
      {label}…
    </div>
  );
}
export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-3 rounded border border-neg/40 bg-neg/10 p-3 text-xs text-neg">
      <div className="font-semibold">Unable to complete request</div>
      <div className="mt-1 text-fg/80">{error}</div>
      {onRetry && (
        <Button size="sm" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
export function Note({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "warn" }) {
  return (
    <div
      className={cn(
        "rounded border px-2.5 py-1.5 text-2xs leading-relaxed",
        tone === "warn" ? "border-warn/40 bg-warn/10 text-warn" : "border-border bg-panel2/60 text-muted",
      )}
    >
      {children}
    </div>
  );
}
