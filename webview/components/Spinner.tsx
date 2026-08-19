import { Codicon } from "./Codicon";

// Spinner basado en codicon-loading (Fase 1 P3: migrado de Orbit lucide),
// animado con la keyframe `sp` existente. Reemplaza al .spin (anillo con
// border) para un look más moderno.
export function Spinner({ size = 14 }: { size?: number }) {
  return <Codicon name="loading" size={size} className="spinner" />;
}
