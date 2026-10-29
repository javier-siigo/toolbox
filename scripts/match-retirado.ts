/**
 * Identifica un excolaborador a partir de un nombre libre, aceptando el orden
 * "nombre apellido" o "apellido nombre". Si hay varias coincidencias parciales,
 * expone los tokens extra (segundo nombre / segundo apellido) para desambiguar.
 *
 * La lógica de matching vive en la RPC `public.match_colaborador_retirado`
 * (creada por la migración `match_colaborador_retirado`). El script sólo
 * formatea la salida y, en modo interactivo, deja al usuario elegir entre
 * múltiples candidatos parciales.
 *
 * Uso:
 *   npm run match:retirado -- "Juan Lopez"
 *   npm run match:retirado -- "LOPEZ JUAN"
 *   npm run match:retirado -- --cedula 1055988289
 *   echo "DIEGO NOVA" | npm run match:retirado -- --stdin
 *   npm run match:retirado -- --json --no-interactive "Juan Diego"
 *
 * Variables de entorno (en .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { config } from "dotenv";
import process from "node:process";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/types/supabase";

config({ path: ".env.local" });

type MatchNivel = "cedula" | "exacto" | "exacto_inverso" | "parcial";

type MatchRow = {
  cedula: number;
  nombre: string;
  valor: number | null;
  observacion: string | null;
  fecha_reporte: string;
  nivel: MatchNivel;
  tokens_comunes: string[];
  tokens_extra: string[];
};

const FUZZY_LIMIT = 25;

type CliArgs = {
  input: string | null;
  cedula: string | null;
  stdin: boolean;
  json: boolean;
  interactive: boolean;
  help: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    input: null,
    cedula: null,
    stdin: false,
    json: false,
    interactive: true,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--cedula") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--cedula requiere un valor numérico");
      }
      args.cedula = next;
      i++;
    } else if (a === "--stdin") {
      args.stdin = true;
    } else if (a === "--json") {
      args.json = true;
    } else if (a === "--no-interactive") {
      args.interactive = false;
    } else if (a === "--interactive") {
      args.interactive = true;
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (!a.startsWith("--")) {
      args.input = a;
    } else {
      throw new Error(`Argumento no reconocido: ${a}`);
    }
  }

  return args;
}

function printHelp(): void {
  process.stdout.write(`match-retirado — identifica un excolaborador por nombre

Uso:
  npm run match:retirado -- [opciones] <nombre>
  echo "<nombre>" | npm run match:retirado -- [opciones] --stdin

Opciones:
  --cedula <n>        Busca por cédula exacta (omite el match por nombre).
  --stdin             Lee el nombre desde stdin en lugar de argv.
  --json              Imprime la salida en JSON.
  --no-interactive    No pregunta; lista todos los candidatos parciales.
  -h, --help          Muestra esta ayuda.

Ejemplos:
  npm run match:retirado -- "Juan Lopez"
  npm run match:retirado -- "LOPEZ JUAN"
  npm run match:retirado -- --cedula 1055988289
  echo "DIEGO NOVA" | npm run match:retirado -- --stdin
  npm run match:retirado -- --json --no-interactive "Juan Diego"
`);
}

async function readInputName(args: CliArgs): Promise<string> {
  if (args.stdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) {
      throw new Error("No se recibió ningún nombre por stdin");
    }
    return text;
  }
  if (!args.input) {
    throw new Error("Falta el nombre a buscar");
  }
  return args.input;
}

async function fetchByCedula(
  supabase: ReturnType<typeof createAdminClient>,
  cedula: number,
): Promise<MatchRow[]> {
  const { data, error } = await supabase
    .schema("anticipos").from("retirados")
    .select("cedula, nombre, valor, observacion, fecha_reporte")
    .eq("cedula", cedula)
    .limit(1);
  if (error) {
    throw new Error(`Error al buscar por cédula: ${error.message}`);
  }
  return (data ?? []).map((r) => ({
    cedula: Number(r.cedula),
    nombre: r.nombre,
    valor: r.valor,
    observacion: r.observacion,
    fecha_reporte: r.fecha_reporte,
    nivel: "cedula",
    tokens_comunes: [],
    tokens_extra: [],
  }));
}

type RpcResult = {
  cedula: number;
  nombre: string;
  valor: number | null;
  observacion: string | null;
  fecha_reporte: string;
  nivel: MatchNivel;
  tokens_comunes: string[];
  tokens_extra: string[];
};

async function fetchByName(
  supabase: ReturnType<typeof createAdminClient>,
  name: string,
): Promise<MatchRow[]> {
  const { data, error } = await supabase.schema("anticipos").rpc("match_colaborador_retirado", {
    p_input: name,
  } satisfies Database["anticipos"]["Functions"]["match_colaborador_retirado"]["Args"]);

  if (error) {
    throw new Error(`Error al buscar por nombre: ${error.message}`);
  }

  return ((data ?? []) as RpcResult[]).map((r) => ({
    cedula: Number(r.cedula),
    nombre: r.nombre,
    valor: r.valor,
    observacion: r.observacion,
    fecha_reporte: r.fecha_reporte,
    nivel: r.nivel,
    tokens_comunes: r.tokens_comunes ?? [],
    tokens_extra: r.tokens_extra ?? [],
  }));
}

function formatCurrency(value: number | null): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(value);
}

function pad(value: string | number, width: number): string {
  const s = String(value);
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return value.slice(0, width - 1) + "…";
}

function printTable(rows: MatchRow[]): void {
  if (rows.length === 0) {
    process.stdout.write("Sin coincidencias.\n");
    return;
  }

  const headers = [
    "#",
    "Nivel",
    "Cédula",
    "Nombre",
    "Valor",
    "Comunes",
    "Extras",
  ];
  const widths = [4, 16, 14, 36, 14, 24, 24];

  const obs = rows[0]?.observacion ?? "";
  if (obs) {
    process.stdout.write(`Observación: ${truncate(obs, 120)}\n\n`);
  }

  const headerLine = headers
    .map((h, i) => pad(h, widths[i] ?? h.length))
    .join("  ");
  process.stdout.write(`${headerLine}\n`);
  process.stdout.write(`${"─".repeat(headerLine.length)}\n`);

  rows.forEach((r, idx) => {
    const cols = [
      pad(String(idx + 1), widths[0] ?? 0),
      pad(r.nivel, widths[1] ?? 0),
      pad(String(r.cedula), widths[2] ?? 0),
      pad(truncate(r.nombre, widths[3] ?? 0), widths[3] ?? 0),
      pad(formatCurrency(r.valor), widths[4] ?? 0),
      pad((r.tokens_comunes ?? []).join(" "), widths[5] ?? 0),
      pad((r.tokens_extra ?? []).join(" "), widths[6] ?? 0),
    ];
    process.stdout.write(`${cols.join("  ")}\n`);
  });
}

function printJson(rows: MatchRow[], query: { cedula: number | null; nombre: string | null }): void {
  process.stdout.write(
    `${JSON.stringify({ query, total: rows.length, resultados: rows }, null, 2)}\n`,
  );
}

async function readLine(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    };
    const onClose = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onClose);
      resolve(buffer.trim());
    };
    process.stdin.on("data", onData);
    process.stdin.once("end", onClose);
    process.stdin.once("close", onClose);
  });
}

async function pickInteractive(rows: MatchRow[]): Promise<MatchRow | null> {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0]!;

  process.stdout.write(
    `\nHay ${rows.length} coincidencias. Elige una opción (1-${rows.length}, 0 para cancelar): `,
  );
  const line = await readLine("");
  const n = Number.parseInt(line, 10);
  if (!Number.isFinite(n) || n < 0 || n > rows.length) {
    process.stdout.write("Selección inválida.\n");
    return null;
  }
  if (n === 0) return null;
  return rows[n - 1]!;
}

function validateCedula(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`Cédula inválida: ${raw}`);
  }
  return n;
}

async function main() {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(`✗ ${(e as Error).message}\n`);
    process.exit(2);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const envUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const envKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!envUrl || !envKey) {
    process.stderr.write(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local\n",
    );
    process.exit(1);
  }

  const supabase = createAdminClient();
  let rows: MatchRow[] = [];
  let query: { cedula: number | null; nombre: string | null } = {
    cedula: null,
    nombre: null,
  };

  try {
    if (args.cedula) {
      const cedula = validateCedula(args.cedula);
      query = { cedula, nombre: null };
      rows = await fetchByCedula(supabase, cedula);
    } else {
      const name = await readInputName(args);
      query = { cedula: null, nombre: name };
      rows = await fetchByName(supabase, name);
    }
  } catch (e) {
    process.stderr.write(`✗ ${(e as Error).message}\n`);
    process.exit(1);
  }

  if (rows.length > FUZZY_LIMIT && !args.json) {
    process.stdout.write(
      `⚠️  Se encontraron ${rows.length} coincidencias; mostrando las primeras ${FUZZY_LIMIT}.\n`,
    );
    rows = rows.slice(0, FUZZY_LIMIT);
  }

  if (args.json) {
    printJson(rows, query);
    if (rows.length === 0) process.exit(2);
    process.exit(0);
  }

  if (rows.length === 0) {
    process.stdout.write("Sin coincidencias.\n");
    process.exit(2);
  }

  const exactos = rows.filter(
    (r) => r.nivel === "exacto" || r.nivel === "exacto_inverso" || r.nivel === "cedula",
  );
  const parciales = rows.filter((r) => r.nivel === "parcial");

  process.stdout.write(`\nCoincidencias para: ${JSON.stringify(query)}\n\n`);

  if (exactos.length > 0) {
    process.stdout.write("--- Coincidencias exactas ---\n");
    printTable(exactos);
  }
  if (parciales.length > 0) {
    if (exactos.length > 0) process.stdout.write("\n");
    process.stdout.write("--- Coincidencias parciales (mismos tokens + extras) ---\n");
    printTable(parciales);
  }

  if (!args.interactive) {
    process.exit(rows.length > 0 ? 0 : 2);
  }

  if (rows.length === 1) {
    const r = rows[0]!;
    process.stdout.write(
      `\n✓ Seleccionado (única coincidencia): ${r.cedula} · ${r.nombre}\n`,
    );
    process.exit(0);
  }

  const seleccion = await pickInteractive(rows);
  if (!seleccion) {
    process.stdout.write("Cancelado.\n");
    process.exit(3);
  }
  process.stdout.write(
    `\n✓ Seleccionado: ${seleccion.cedula} · ${seleccion.nombre}\n`,
  );
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`✗ ${(e as Error).message}\n`);
  process.exit(1);
});
