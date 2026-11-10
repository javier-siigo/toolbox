"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Copy, Play } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Bloque de código con botón Copiar (mismo patrón que los asientos de comisiones).
 * Los bloques ```suiteql``` (solo en documentos de admin) abren además la consola SuiteQL.
 */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copiado, setCopiado] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiado(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiado(false), 1500);
    } catch {
      setCopiado(false);
    }
  };

  return (
    <div className="group/code my-4 overflow-hidden rounded-md border border-border bg-background">
      <div className="flex h-9 items-center justify-between border-b border-border bg-muted/50 pl-3 pr-1.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
          {lang || "texto"}
        </span>
        <div className="flex items-center gap-0.5">
        {lang === "suiteql" && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" asChild>
            <Link href={`/admin/suiteql?q=${encodeURIComponent(code)}`}>
              <Play className="size-3.5" aria-hidden />
              Probar en consola
            </Link>
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => void copiar()}
          aria-label={copiado ? "Copiado" : "Copiar código"}
        >
          {copiado ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copiado ? "Copiado" : "Copiar"}
        </Button>
        </div>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-6 text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
