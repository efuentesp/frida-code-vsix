import type { ResourceSummary } from "../types";

// Barra fija de una línea con los conteos de recursos cargados.
// Solo informativa; el detalle se abre con el botón "Recursos" (Library) del header.
export function ResourcesBar({ res }: { res: ResourceSummary }) {
  const parts: string[] = [];
  if (res.extensions.length) parts.push(`${res.extensions.length} extensiones`);
  if (res.skills.length) parts.push(`${res.skills.length} skills`);
  if (res.prompts.length) parts.push(`${res.prompts.length} prompts`);
  if (res.themes.length) parts.push(`${res.themes.length} themes`);
  if (res.contextFiles.length) parts.push(`${res.contextFiles.length} contexto`);
  if (res.errors.length) parts.push(`${res.errors.length} errores`);

  return (
    <div className={"res-bar" + (res.errors.length ? " has-errors" : "")}>
      <span className="res-ic">✦</span>
      <span className="res-summary">{parts.join(" · ") || "Sin recursos externos"}</span>
    </div>
  );
}
