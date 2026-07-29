import { useState } from "react";
import type { ReactElement } from "react";

// Demo de Remote React (opción A): un contador interactivo con ESTADO.
// Se monta vía webBridge.render() desde el comando "Frida: Demo Remote React".
// Validación del ciclo end-to-end:
//   host: WebDemo corre en el custom renderer (useState funciona) → árbol <fbox>
//   commit: serializa (onClick → handlerId) → post web_commit
//   webview: RemoteRoot materializa (fbox→div, fbutton→button)
//   click +1 → web_event{handlerId} → host fireEvent → setN → re-render → diff
//
// Usa tags intrinsic de frida-webview (fbox/ftext/fbutton), tipados por el
// declare global en src/frida-webview/index.ts.

export function createWebDemoElement(
	done: (result: number) => void,
): ReactElement {
	return <WebDemo done={done} />;
}

function WebDemo({ done }: { done: (result: number) => void }): ReactElement {
	const [n, setN] = useState(0);

	return (
		<fbox flexDirection="column" gap={8} padding={12} bordered>
			<ftext bold>🧪 Demo Remote React — contador: {n}</ftext>
			<fbox flexDirection="row" gap={8}>
				<fbutton onClick={() => setN(n - 1)}>−1</fbutton>
				<fbutton onClick={() => setN(n + 1)} variant="secondary">
					+1
				</fbutton>
			</fbox>
			<fbutton variant="danger" onClick={() => done(n)}>
				Cerrar (devuelve {n})
			</fbutton>
		</fbox>
	);
}
