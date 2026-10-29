import Link from "next/link";
import { BookOpen, LayoutDashboard } from "lucide-react";

import { requireSesion } from "@/lib/auth/acceso";
import { filterAreas } from "@/lib/auth/permisos-shared";
import { periodoActual, periodoLabel, shiftPeriodo } from "@/lib/comisiones/calculo";
import {
  ahoraBogota,
  DIAS_ATRASO,
  resumenInicio,
  type ResumenInicio,
} from "@/lib/inicio/resumen";
import { AREAS, type Area, type Proceso } from "@/lib/navigation";
import { BandejaAtencion, type ItemAtencion } from "@/components/inicio/atencion";
import { ProcesosPorArea, type CifraProceso } from "@/components/inicio/procesos";
import { PageTransition } from "@/components/motion/page-transition";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Inicio",
};

const PASOS_CIERRE = [
  "registra las comisiones causadas del mes",
  "ingresa la facturación F93/F94 del mes",
  "carga el informe diferido del mes",
  "revisa el cálculo y guarda el cierre",
];

const FECHA = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long" });

function saludo(hora: number): string {
  if (hora < 12) return "Buenos días";
  if (hora < 19) return "Buenas tardes";
  return "Buenas noches";
}

function plural(n: number, uno: string, varios: string): string {
  return n === 1 ? uno : varios;
}

/** Pendientes reales según el resumen, del más urgente al menos urgente. */
function itemsAtencion(r: ResumenInicio): ItemAtencion[] {
  const items: ItemAtencion[] = [];
  if (r.anticipos && r.anticipos.atrasados > 0) {
    const a = r.anticipos;
    items.push({
      id: "anticipos-atrasados",
      tono: "rojo",
      cifra: { tipo: "numero", valor: a.atrasados },
      titulo: `${plural(a.atrasados, "Anticipo", "Anticipos")} sin gestión hace más de ${DIAS_ATRASO} días`,
      detalle: `Gestión de anticipos · de ${a.pendientes} pendientes`,
      accion: { label: "Ver anticipos", href: "/ingresos/gestion-anticipos" },
    });
  }
  if (r.anticipos && r.anticipos.devoluciones > 0) {
    const n = r.anticipos.devoluciones;
    items.push({
      id: "anticipos-devoluciones",
      tono: "ambar",
      cifra: { tipo: "numero", valor: n },
      titulo: `${plural(n, "Devolución", "Devoluciones")} de anticipo por gestionar`,
      detalle: "Gestión de anticipos · falta: devolución",
      accion: { label: "Ver anticipos", href: "/ingresos/gestion-anticipos" },
    });
  }
  const paso = r.comisiones?.pasoActual ?? null;
  if (r.comisiones && paso !== null) {
    const c = r.comisiones;
    const mes = c.etiqueta.split(" ")[0]!.toLowerCase();
    items.push({
      id: "comisiones-cierre",
      tono: "ambar",
      cifra: { tipo: "pasos", hechos: c.hechos },
      titulo: `Cierre de comisiones de ${mes} en el paso ${paso} de 4`,
      detalle: `Siguiente: ${PASOS_CIERRE[paso - 1]}`,
      accion: { label: "Continuar", href: "/ingresos/calculo-comisiones" },
    });
  }
  if (r.admin && r.admin.sinPermisos > 0) {
    const n = r.admin.sinPermisos;
    items.push({
      id: "usuarios-sin-permisos",
      tono: "azul",
      cifra: { tipo: "numero", valor: n },
      titulo: `${plural(n, "Usuario", "Usuarios")} sin permisos`,
      detalle: "No ven ningún proceso hasta que les des acceso a uno",
      accion: { label: "Asignar permisos", href: "/admin/usuarios" },
    });
  }
  return items;
}

const SIN_DATOS: CifraProceso = { valor: "—", detalle: "No se pudo cargar" };

function cifraProceso(r: ResumenInicio, ahora: Date) {
  return (area: Area, proceso: Proceso): CifraProceso => {
    if (area.slug === "conciliaciones" && proceso.flagCode) {
      if (r.bancos === null) return SIN_DATOS;
      const n = r.bancos?.[proceso.flagCode] ?? 0;
      return n > 0
        ? { valor: String(n), unidad: plural(n, "banco", "bancos"), detalle: "Configurados para conciliar" }
        : { valor: "Próximamente", detalle: "Sin bancos configurados", apagado: true };
    }
    switch (proceso.slug) {
      case "gestion-anticipos": {
        if (!r.anticipos) return SIN_DATOS;
        const a = r.anticipos;
        const pct = a.total === 0 ? 0 : Math.round((a.legalizados / a.total) * 100);
        return {
          valor: String(a.pendientes),
          unidad: plural(a.pendientes, "pendiente", "pendientes"),
          detalle: `${a.legalizados} ${plural(a.legalizados, "legalizado", "legalizados")} · ${pct}% del total`,
        };
      }
      case "calculo-comisiones": {
        if (!r.comisiones) return SIN_DATOS;
        const c = r.comisiones;
        return {
          valor: c.pasoActual === null ? "Cerrado" : `Paso ${c.pasoActual} de 4`,
          detalle: `Cierre de ${c.etiqueta.toLowerCase()}`,
          pasos: c.hechos,
        };
      }
      case "notas-credito":
        return { valor: "Bajo demanda", detalle: "Sube el INFORME y procésalo" };
      case "export-bancos":
        return {
          valor: periodoLabel(shiftPeriodo(periodoActual(ahora), -1)),
          detalle: "Último mes completo para exportar",
        };
      default:
        return { valor: "", detalle: proceso.description };
    }
  };
}

export default async function DashboardPage() {
  // Inicio no es un proceso: basta la sesión; cada bloque se filtra por permisos.
  const sesion = await requireSesion();
  const { permisos } = sesion;
  // Ingresos primero: es donde viven las cifras y los pendientes medibles.
  const areas = filterAreas(permisos, AREAS)
    .filter((a) => !a.enMenuUsuario)
    .sort((a, b) => Number(b.slug === "ingresos") - Number(a.slug === "ingresos"));

  if (areas.length === 0 && !permisos.esAdmin) {
    return (
      <PageTransition>
        <EmptyState
          icon={<LayoutDashboard className="size-7" />}
          title="Aún no tienes procesos asignados"
          description="Cuando un administrador te dé acceso a un proceso, aparecerá aquí."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/documentacion">Ver la documentación</Link>
            </Button>
          }
        />
      </PageTransition>
    );
  }

  const ahora = ahoraBogota();
  const resumen = await resumenInicio(permisos, ahora);
  const items = itemsAtencion(resumen);
  // Solo hay bandeja si algún proceso aporta pendientes que se puedan medir.
  const conBandeja = resumen.anticipos !== undefined || resumen.admin !== undefined;
  const nombre = sesion.nombre.split(" ")[0];
  const fechaLarga = FECHA.format(ahora);
  const fecha = fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1);

  return (
    <PageTransition>
      <div className="flex flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-tight text-foreground">
              {saludo(ahora.getHours())}
              {nombre ? `, ${nombre}` : ""}
            </h1>
            <p className="text-sm text-muted-foreground">
              {fecha}
              {conBandeja &&
                (items.length > 0
                  ? ` · ${items.length} ${plural(items.length, "cosa necesita", "cosas necesitan")} tu atención`
                  : " · todo al día")}
            </p>
          </div>
          <Button asChild variant="ghost" size="sm" className="text-muted-foreground">
            <Link href="/documentacion">
              <BookOpen aria-hidden />
              Cómo funciona cada proceso
            </Link>
          </Button>
        </header>

        {conBandeja && <BandejaAtencion items={items} />}

        <ProcesosPorArea areas={areas} cifraDe={cifraProceso(resumen, ahora)} />
      </div>
    </PageTransition>
  );
}
