import { useSyncExternalStore } from "react";
import type { ReactElement } from "react";

// Demo de Remote React PERSISTENTE (Fase A, ADR-0014): valida el caso del tool
// `todo` — un panel que vive toda la sesión y se re-renderiza ante un STORE
// EXTERNO (no diálogo). A diferencia de web-demo.tsx (que usa useState interno y
// bloquea hasta done), este se monta con webBridge.mountPersistent() y vive hasta
// unmount() explícito.
//
// Lo que valida:
//  1. mountPersistent monta sin bloquear (no hay done/await).
//  2. El store externo (timer 2s + botón +1) muta fuera del componente.
//  3. useSyncExternalStore(subscribe, getSnapshot) → el componente re-renderiza
//     → el reconciler serializa el nuevo commit → el webview actualiza SOLO.
//  4. onClose → handle.unmount() → tree:null → el panel desaparece del webview.
//
// Si esto funciona, el patrón del tool `todo` (store reactivo + panel persistente)
// es viable sin tocar el reconciler.

// --- Store de demo (módulo): contador que sube solo cada 2s + por botón. ---
let demoValue = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function emit(): void {
	for (const l of listeners) l();
}

export const demoPersistentStore = {
	subscribe(l: () => void): () => void {
		listeners.add(l);
		// Arrancar el timer con el primer suscriptor (paridad con cómo el todo
		// empezaría a escuchar mutaciones del tool al montar el panel).
		if (listeners.size === 1 && timer === undefined) {
			timer = setInterval(() => {
				demoValue++;
				emit();
			}, 2000);
		}
		return () => {
			listeners.delete(l);
			// Al irse el último oyente: detener el timer y resetear (cada demo
			// arranca limpio, igual que una sesión nueva del todo).
			if (listeners.size === 0 && timer !== undefined) {
				clearInterval(timer);
				timer = undefined;
				demoValue = 0;
			}
		};
	},
	getSnapshot(): number {
		return demoValue;
	},
	increment(): void {
		demoValue++;
		emit();
	},
};

export function createPersistentDemoElement(onClose: () => void): ReactElement {
	return <PersistentDemo onClose={onClose} />;
}

function PersistentDemo({ onClose }: { onClose: () => void }): ReactElement {
	const value = useSyncExternalStore(
		demoPersistentStore.subscribe,
		demoPersistentStore.getSnapshot,
	);
	return (
		<fbox flexDirection="column" gap={8} padding={12}>
			<ftext bold>🧪 Demo Persistente — contador: {value}</ftext>
			<ftext>Sube solo cada 2s (timer) o con el botón. Sin diálogo.</ftext>
			<fbox flexDirection="row" gap={8}>
				<fbutton onClick={() => demoPersistentStore.increment()}>
					+1 manual
				</fbutton>
				<fbutton variant="danger" onClick={onClose}>
					Detener demo (unmount)
				</fbutton>
			</fbox>
		</fbox>
	);
}
