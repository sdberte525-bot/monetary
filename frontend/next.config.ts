import type { NextConfig } from "next";

// All /api/* requests are proxied to the FastAPI backend, so the browser never
// needs CORS and the backend URL is configured in one place (BACKEND_URL).
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
};

export default nextConfig;
