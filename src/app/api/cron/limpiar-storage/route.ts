import { NextResponse } from "next/server";

import { limpiarStorage } from "@/lib/storage/limpieza";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel Cron (ver vercel.json) llama con `Authorization: Bearer $CRON_SECRET`.
// El proxy deja pasar /api/cron sin sesión, así que este check es la única barrera.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  try {
    const resultados = await limpiarStorage();
    const conError = resultados.some((r) => r.error);
    return NextResponse.json({ resultados }, { status: conError ? 500 : 200 });
  } catch (err) {
    console.error("[cron/limpiar-storage]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
