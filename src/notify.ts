// Notificaciones al usuario cuando Frida termina una petición O necesita su
// atención (un permiso o una pregunta) y NO está mirando (la ventana de VS Code
// perdió el foco → está en otra aplicación).
//
// VS Code NO expone una API nativa para que una extensión emita sonidos: se
// verificó en @types/vscode (1.125) y en los 176 archivos de APIs propuestas del
// repo de VS Code —ninguno trata de sonido. Los "Audio Cues / Accessibility
// Signals" son settings internos del editor, no una API para extensiones. Por
// eso el sonido se reproduce con un comando del sistema operativo: es lo único
// fiable para que se oiga incluso cuando el usuario está en otra aplicación.
import { spawn } from "node:child_process";
import * as os from "node:os";
import * as vscode from "vscode";

type SoundKind = "complete" | "attention";

// Sonido por SO y tipo. "complete" = terminó (tono de "listo"); "attention" =
// te necesita (tono de "hey, mírame"). Sonidos distintos → el usuario sabe sin
// mirar si Frida terminó o lo espera.
//   • macOS:    Glass (listo) / Ping (atención) — de /System/Library/Sounds.
//   • Windows:  SystemSounds.Asterisk (listo) / .Exclamation (atención).
//   • Linux:    freedesktop complete.oga (listo) / dialog-warning.oga (atención).
const MAC_SOUND: Record<SoundKind, string> = {
	complete: "/System/Library/Sounds/Glass.aiff",
	attention: "/System/Library/Sounds/Ping.aiff",
};
const WIN_PS: Record<SoundKind, string> = {
	complete: "Asterisk",
	attention: "Exclamation",
};
const LINUX_SOUND: Record<SoundKind, string> = {
	complete: "/usr/share/sounds/freedesktop/stereo/complete.oga",
	attention: "/usr/share/sounds/freedesktop/stereo/dialog-warning.oga",
};

/**
 * Reproduce un sonido con el comando nativo del SO. Best-effort: si el binario o
 * el archivo de sonido no existen, el spawn falla en silencio (stdio: "ignore")
 * y nunca rompe el flujo. El proceso se suelta (.unref) para que no mantenga
 * vivo el proceso de la extensión al cerrar.
 */
export function playSound(kind: SoundKind): void {
	try {
		const platform = os.platform();
		if (platform === "darwin") {
			spawn("afplay", [MAC_SOUND[kind]], {
				stdio: "ignore",
				detached: true,
			}).unref();
		} else if (platform === "win32") {
			// SystemSounds usa el sistema de audio de Windows (altavoces), NO el PC
			// speaker: [console]::beep sólo se oye en hardware con speaker interno,
			// que muchos portátiles modernos no tienen. El Start-Sleep da tiempo a
			// que se reproduzca antes de que el proceso cierre (Play es asíncrono).
			spawn(
				"powershell",
				[
					"-NoProfile",
					"-Command",
					`[System.Media.SystemSounds]::${WIN_PS[kind]}.Play(); Start-Sleep -Milliseconds 800`,
				],
				{
					stdio: "ignore",
					detached: true,
				},
			).unref();
		} else {
			// Linux: no hay un reproductor universal. Probamos varios en cadena: paplay
			// (PulseAudio/PipeWire, casi ubiquitous en escritorios), ogg123 (vorbis-tools)
			// y play (sox). El primero que exista y reproduzca el .oga del theme
			// freedesktop gana. sh -c permite encadenar con ||; el || true final evita
			// código de salida non-zero. WSL/sin sound-theme: todo falla en silencio.
			const snd = LINUX_SOUND[kind];
			const cmd = `paplay '${snd}' 2>/dev/null || ogg123 -q '${snd}' 2>/dev/null || play -q '${snd}' 2>/dev/null || true`;
			spawn("sh", ["-c", cmd], {
				stdio: "ignore",
				detached: true,
			}).unref();
		}
	} catch {
		// El sonido es best-effort: jamás debe propagar un error al flujo principal.
	}
}

/**
 * ¿Está activada la notificación de Frida? Se lee en cada llamada para respetar
 * cambios del setting sin necesidad de recargar. Por defecto: true.
 */
export function notifyOnCompleteEnabled(): boolean {
	return vscode.workspace
		.getConfiguration("frida")
		.get<boolean>("notifyOnComplete", true);
}

/** Muestra un toast con un botón "Ver" que enfoca la vista del chat. */
async function toastWithView(message: string): Promise<void> {
	const action = await vscode.window.showInformationMessage(message, "Ver");
	if (action === "Ver") {
		void vscode.commands.executeCommand("frida.openPanel");
	}
}

/**
 * Emite sonido "de listo" + notificación al TERMINAR una petición. Sólo actúa si
 * el setting está activo Y la ventana de VS Code no tiene el foco (estás en otra
 * app); si estás mirando a Frida, no hay nada que avisar.
 */
export async function notifyCompletion(windowFocused: boolean): Promise<void> {
	if (!notifyOnCompleteEnabled() || windowFocused) return;
	playSound("complete");
	await toastWithView("Frida terminó de procesar tu petición.");
}

/**
 * Emite sonido "de atención" + notificación cuando Frida NECESITA al usuario
 * (un permiso Accept/Reject, o una pregunta ask_user_question). Mismo guard de
 * setting + foco que notifyCompletion. kind → mensaje del toast.
 */
export async function notifyAttention(
	windowFocused: boolean,
	kind: "approval" | "ui",
): Promise<void> {
	if (!notifyOnCompleteEnabled() || windowFocused) return;
	playSound("attention");
	await toastWithView(
		kind === "approval"
			? "Frida necesita tu permiso para continuar."
			: "Frida te hizo una pregunta.",
	);
}
