// Protocolo Remote React (opción A): el host monta un ReactElement con un custom
// renderer (react-reconciler) y serializa cada commit a un árbol WebNode que el
// webview materializa. Los eventos del webview vuelven por RPC (handler IDs).
//
// flujo:
//   host: <Box><Button onClick={fn}/></Box>
//      → renderer crea WebNode{type:"frida.Box", children:[{type:"frida.Button", props:{onClick:"h#3"}}]}
//      → commit: post {type:"web_commit", tree}
//   webview: RemoteRoot materializa (frida.Box→div, frida.Button→button)
//      → click → post {type:"web_event", handlerId:"h#3"}
//   host: handlerTable.get("h#3")(event) → React re-renderiza → diff → nuevo commit
//
// Los tipos de host son STRINGS con prefijo "frida." (frida-webview los exporta así).
// Esto permite que la extensión escriba `<Box>` y el custom renderer serialice
// {type:"frida.Box"} sin ejecutar el componente (no hay DOM en el host).

/** Un nodo del árbol serializado. Los children van aparte (array plano con keys). */
export interface WebNode {
	/** Tipo de host, ej. "frida.Box", "frida.Text", "frida.Button". Los textos son type:"frida.Text#literal". */
	type: string;
	/** Props serializadas: strings, números, booleanos, arrays, objetos. Las funciones → handlerId (string "h#N"). */
	props: Record<string, unknown>;
	/** Hijos: WebNode[] o strings (texto literal). */
	children: Array<WebNode | string>;
}

/** Dónde materializa el webview un root remoto: "overlay" (cuerpo, ej. diálogos
 *  efímeros como ask_user_question) o "footer" (panel inferior junto al Composer,
 *  ej. el panel persistente del tool `todo`). */
export type WebPlacement = "overlay" | "footer";

/** Host → webview: un commit es el árbol raíz completo (snapshot). El webview
 *  reemplaza su subárbol remoto por completo. Suficiente para UIs de extensión
 *  (pequeñas); el diffing incremental es mejora futura si el parpadeo molesta. */
export interface WebCommitMessage {
	type: "web_commit";
	/** ID de la sesión de UI remota (para emparejar commits con la instancia). */
	rootId: string;
	/** null = desmontar (la factory resolvió done() o se canceló). */
	tree: WebNode | null;
	/** Zona del webview donde vive el root (default "overlay"). */
	placement?: WebPlacement;
}

/** Webview → host: el usuario disparó un evento sobre un elemento con handler. */
export interface WebEventMessage {
	type: "web_event";
	rootId: string;
	/** ID del handler en la tabla del host (props.onClick/etc. serializado como "h#N"). */
	handlerId: string;
	/** Payload mínimamente serializado del evento DOM:
	 *  {value} para input/textarea, {checked} para checkbox, {} para click. */
	payload: { value?: string; checked?: boolean };
}

/** Mensajes del canal web (ambas direcciones). */
export type WebMessage = WebCommitMessage | WebEventMessage;

/** Prefijo de los tipos de host de frida-webview. */
export const FRIDA_HOST_PREFIX = "frida.";

/** ¿Es un handler serializable? (función → se reemplaza por ID en la tabla). */
export function isHandler(v: unknown): v is (...args: any[]) => void {
	return typeof v === "function";
}
