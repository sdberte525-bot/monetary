import type { NextConfig } from "next";

// Two deployment modes:
//  * server (default): /api/* is proxied to the FastAPI backend at BACKEND_URL.
//  * browser (NEXT_PUBLIC_ENGINE=browser): a fully static export (e.g. GitHub Pages);
//    the same Python engine runs client-side in Pyodide (see public/engine/worker.js).
const browser = process.env.NEXT_PUBLIC_ENGINE === "browser";
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = browser
  ? {
      reactStrictMode: true,
      output: "export",
      basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
      trailingSlash: true,
      images: { unoptimized: true },
    }
  : {
      reactStrictMode: true,
      async rewrites() {
        return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
      },
    };

export default nextConfig;
