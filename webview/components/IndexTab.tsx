// Tab "Index" del SettingsHub: estado y acciones de frida-codebase-index
// (instalación on-demand del paquete upstream, indexación, rebuild, estado).
// El estado llega por InMessage codebase_index_state; las acciones salen por
// codebase_index_action y las ejecuta el host (src/extension.ts).
//
// Mientras hay acción en curso (busy): barra indeterminada animada + reloj de
// tiempo transcurrido + texto de contexto. npm no imprime progreso intermedio
// (la descarga de ~256 MB es silenciosa minutos enteros), así que la señal de
// vida la damos nosotros — el usuario nunca debe dudar de si algo pasa.
import { useEffect, useRef, useState } from "react";
import { Codicon } from "./Codicon";
import type { OutMessage, State } from "../types";

/** Formatea segundos como m:ss (el reloj de la barra de progreso). */
function fmtElapsed(totalSec: number): string {
	const m = Math.floor(totalSec / 60);
	const s = totalSec % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

export function IndexTab({
	state,
	post,
}: {
	state: State;
	post: (m: OutMessage) => void;
}) {
	const ci = state.codebaseIndex;
	const busy = ci?.busy ?? null;
	// Reloj de la acción en curso: arranca cuando busy pasa a truthy, se limpia
	// al terminar. Es la prueba de vida cuando npm está en silencio.
	const [elapsed, setElapsed] = useState(0);
	const startedAt = useRef<number | null>(null);
	useEffect(() => {
		startedAt.current = busy ? Date.now() : null;
		setElapsed(0);
	}, [busy]);
	useEffect(() => {
		if (!busy) return;
		const t = setInterval(() => {
			if (startedAt.current)
				setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
		}, 1000);
		return () => clearInterval(t);
	}, [busy]);
	return (
		<div className="cfg-resources">
			<div className="cfg-section">
				<Codicon name="database" size={13} /> Índice de código (semántico + call graph)
			</div>
			<div className="cfg-row-desc" style={{ marginBottom: 8 }}>
				Búsqueda por significado, grafo de llamadas y lookup de implementaciones
				(6 tools del agente). Requiere un paquete on-demand (~256 MB, se poda a
				~1/5 del disco) y un proveedor de embeddings (Ollama local, tu key de
				OpenAI, o endpoint custom en settings frida.codebaseIndex.*).
			</div>
			<div className="cfg-res-actions">
				{!ci?.installed && (
					<button
						className="pc-save"
						disabled={!!ci?.busy}
						onClick={() =>
							post({ type: "codebase_index_action", action: "install" })
						}
					>
						{ci?.busy === "install" ? (
							<>
								<Codicon name="loading" size={13} spin /> Instalando…
							</>
						) : (
							<>
								<Codicon name="cloud-download" size={13} /> Instalar paquete
							</>
						)}
					</button>
				)}
				{ci?.installed && (
					<>
						<button
							className="pc-save"
							disabled={!!ci?.busy}
							onClick={() =>
								post({ type: "codebase_index_action", action: "index" })
							}
						>
							{ci?.busy === "index" ? (
								<>
									<Codicon name="loading" size={13} spin /> Indexando…
								</>
							) : (
								<>
									<Codicon name="refresh" size={13} /> Indexar (incremental)
								</>
							)}
					</button>
						<button
							className="pc-save"
							disabled={!!ci?.busy}
							onClick={() =>
								post({ type: "codebase_index_action", action: "rebuild" })
							}
						>
							<Codicon name="tools" size={13} /> Rebuild completo
						</button>
						<button
							className="pc-save"
							disabled={!!ci?.busy}
							onClick={() =>
								post({ type: "codebase_index_action", action: "status" })
							}
						>
							<Codicon name="database" size={13} /> Estado del índice
						</button>
					</>
				)}
			</div>
			{busy && (
				<div className="ci-busy">
					<div className="ci-busy-bar" role="progressbar" aria-label="En progreso">
						<span />
					</div>
					<div className="cfg-row-desc">
						{busy === "install" ? (
							<>
								Descargando e instalando el paquete (~256 MB). npm no imprime
								progreso intermedio: es normal que solo veas esta barra avanzar
								durante un par de minutos — el reloj confirma que sigue
								trabajando. <strong>Tiempo: {fmtElapsed(elapsed)}</strong>
							</>
						) : (
							<>
								Indexando el workspace — puede tardar según el tamaño del
								repo. <strong>Tiempo: {fmtElapsed(elapsed)}</strong>
							</>
						)}
					</div>
				</div>
			)}
			{ci?.lastLine && <div className="cfg-row-desc">{ci.lastLine}</div>}
      <div className="cfg-row">
        <div className="cfg-row-info">
          <div className="cfg-row-title">Paquete upstream</div>
          <div className="cfg-row-desc">
            {ci?.installed
              ? `Instalado${ci.version ? ` (v${ci.version})` : ""} (${ci.capturedTools?.length ?? 0} tools capturadas)`
              : "No instalado — las tools del agente responden con la guía de instalación"}
          </div>
        </div>
      </div>
      <div className="cfg-row">
        <div className="cfg-row-info">
          <div className="cfg-row-title">Embeddings</div>
          <div className="cfg-row-desc">
            Ollama local (`ollama pull nomic-embed-text`), tu key de OpenAI ya
            guardada en Frida, o endpoint custom. Sin índice, las tools muestran
            la guía del proveedor.
          </div>
        </div>
      </div>
    </div>
  );
}
