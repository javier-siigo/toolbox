import type { Parent, Root, RootContent } from "mdast";

export type MapaAnclas = Map<string, { slug: string; anclas: Set<string> }>;

const EXTERNO = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const ARCHIVO_MD = /^(?:\.\/)?([^/#?]+\.md)(?:#(.*))?$/;

function decodificar(ancla: string): string {
  try {
    return decodeURIComponent(ancla);
  } catch {
    return ancla;
  }
}

/**
 * Destino de un enlace del markdown, o `null` si el usuario no debe ver un
 * enlace ahí (documento sin permiso, sección restringida o ruta del repo).
 */
function resolver(url: string, archivoActual: string, mapa: MapaAnclas): string | null {
  if (EXTERNO.test(url)) return url;
  // Rutas del portal (p. ej. `/admin/suiteql`): la página destino valida el acceso.
  if (url.startsWith("/")) return url;
  if (url.startsWith("#")) {
    return mapa.get(archivoActual)?.anclas.has(decodificar(url.slice(1))) ? url : null;
  }
  const m = ARCHIVO_MD.exec(url);
  if (!m) return null;
  const destino = mapa.get(m[1]!);
  if (!destino) return null;
  const base = `/documentacion/${destino.slug}`;
  const ancla = m[2] ? decodificar(m[2]) : "";
  // Si el ancla quedó oculta para este usuario, se enlaza al documento.
  return ancla && destino.anclas.has(ancla) ? `${base}#${ancla}` : base;
}

function reescribir(parent: Parent, archivoActual: string, mapa: MapaAnclas) {
  const hijos = parent.children as RootContent[];
  for (let i = 0; i < hijos.length; i++) {
    const nodo = hijos[i]!;
    if (nodo.type === "link") {
      const destino = resolver(nodo.url, archivoActual, mapa);
      if (destino === null) {
        // Se deja solo el texto del enlace.
        hijos.splice(i, 1, ...nodo.children);
        i--;
        continue;
      }
      nodo.url = destino;
    }
    if ("children" in nodo) reescribir(nodo, archivoActual, mapa);
  }
}

/** Plugin de remark: enlaces relativos entre `.md` → `/documentacion/<slug>#ancla`. */
export function remarkEnlaces(opciones: { archivoActual: string; mapa: MapaAnclas }) {
  return (tree: Root) => reescribir(tree, opciones.archivoActual, opciones.mapa);
}
