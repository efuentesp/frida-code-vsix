import { Codicon } from "./Codicon";

// Spinner basado en codicon loading animado con la clase codicon-modifier-spin.
export function Spinner({ size = 14 }: { size?: number }) {
	return <Codicon name="loading" size={size} spin className="spinner" />;
}
