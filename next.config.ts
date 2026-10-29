import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // /documentacion/[slug] lee docs/procesos con fs en tiempo de ejecución:
  // sin esto los .md no viajan en la función serverless de Vercel.
  outputFileTracingIncludes: {
    "/documentacion/**": ["./docs/procesos/**/*.md"],
  },
  // Rutas anteriores a la unión de Ingresos y Egresos (y a la sección Reportes), para que
  // marcadores y enlaces compartidos sigan funcionando. El orden importa: la específica primero.
  async redirects() {
    return [
      { source: "/ingresos/export-bancos", destination: "/reportes/export-bancos", permanent: true },
      { source: "/ingresos/:proceso", destination: "/ingresos-egresos/:proceso", permanent: true },
      { source: "/egresos/:proceso", destination: "/ingresos-egresos/:proceso", permanent: true },
    ];
  },
};

export default nextConfig;
