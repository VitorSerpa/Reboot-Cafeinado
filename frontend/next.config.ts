import type { NextConfig } from "next";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3333";

const nextConfig: NextConfig = {
  // A API passa pelo Next (/api → Express): mesmo domínio, sem CORS e com o cookie de sessão simples.
  // O WebSocket vai direto ao backend (lib/backend.ts); o cookie vale lá porque cookie não depende da porta.
  // Na Vercel, quem manda /api ao backend é o vercel.json, antes de chegar ao Next: aqui não há o que repassar.
  async rewrites() {
    if (process.env.VERCEL) return [];
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
  experimental: {
    // Um turno do agente pode passar de 30 s, o padrão do proxy de rewrites.
    proxyTimeout: 200_000,
  },
};

export default nextConfig;
