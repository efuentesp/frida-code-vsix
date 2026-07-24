import type { ResourceSummary } from "../types";

// Barra compacta de una línea con conteos de recursos cargados.
// No intrusiva: vive sobre el chat, no lo bloquea, y se descarta con ✕.
export function ResourcesBar({
  res,
  onDetails,
  onDismiss,
}: {
  res: ResourceSummary;
  onDetails: () => void;
  onDismiss: () => void;
}) {
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
      <button className="res-link" onClick={onDetails} title="Ver detalle">
        detalles
      </button>
      <button className="res-x" onClick={onDismiss} title="Ocultar barra">
        ✕
      </button>
    </div>
  );
}
