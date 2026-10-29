import "server-only";

import { unstable_cache } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface BancoConciliacion {
  slug: string;
  nombre: string;
  descripcion: string | null;
  esParticular: boolean;
}

export interface BancoConciliacionCompleto extends BancoConciliacion {
  webhookUrl: string;
}

function mapBanco(
  row: Record<string, unknown>,
): BancoConciliacion | BancoConciliacionCompleto {
  const slug = row.slug as string;
  const nombre = row.nombre as string;
  const descripcion = (row.descripcion as string | null) ?? null;
  const esParticular = Boolean(row.es_particular);
  const base = { slug, nombre, descripcion, esParticular };
  if ("webhook_url" in row) {
    return { ...base, webhookUrl: row.webhook_url as string };
  }
  return base;
}

export async function getBancosPorPais(
  pais: string,
): Promise<BancoConciliacion[]> {
  const cached = unstable_cache(
    async () => {
      const admin = createAdminClient();
      const { data, error } = await admin
        .schema("conciliaciones").from("bancos")
        .select("slug, nombre, descripcion, es_particular")
        .eq("pais", pais)
        .eq("activo", true)
        .order("orden", { ascending: true })
        .order("nombre", { ascending: true });
      if (error || !data) return [] as BancoConciliacion[];
      return data.map((row) => mapBanco(row) as BancoConciliacion);
    },
    ["conciliacion-bancos", pais],
    { revalidate: 60, tags: ["conciliacion-bancos"] },
  );
  return cached();
}

export async function getBancoPorSlug(
  pais: string,
  slug: string,
): Promise<BancoConciliacionCompleto | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .schema("conciliaciones").from("bancos")
    .select("slug, nombre, descripcion, es_particular, webhook_url, activo")
    .eq("pais", pais)
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  if (!data.activo) return null;
  return mapBanco(data) as BancoConciliacionCompleto;
}
