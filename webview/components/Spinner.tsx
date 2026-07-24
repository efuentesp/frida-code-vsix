import { Orbit } from "lucide-react";

// Spinner basado en el icono Orbit de lucide, animado con la keyframe `sp`
// existente. Reemplaza al .spin (anillo con border) para un look más moderno.
export function Spinner({ size = 14 }: { size?: number }) {
  return <Orbit size={size} className="spinner" />;
}
