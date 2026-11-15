import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/shell";
import { TooltipProvider } from "@/components/ui/primitives";
import { PortfolioProvider } from "@/lib/portfolio-store";

export const metadata: Metadata = {
  title: "MONETARY — Fixed Income & Monetary Policy Risk Terminal",
  description:
    "Interactive quantitative research platform for Treasury yield curves, bond pricing, portfolio interest-rate risk and monetary-policy scenarios.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body
        style={
          {
            "--font-sans": "Inter, 'Segoe UI', Roboto, system-ui, sans-serif",
            "--font-mono": "'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
          } as React.CSSProperties
        }
        className="font-sans antialiased"
      >
        <TooltipProvider>
          <PortfolioProvider>
            <Shell>{children}</Shell>
          </PortfolioProvider>
        </TooltipProvider>
      </body>
    </html>
  );
}
