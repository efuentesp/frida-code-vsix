// Constantes, reserved labels y tipos de error del tool `ask_user_question`.
//
// Fuente única de verdad: el schema TypeBox (ask-user-question.ts) y la
// validación runtime (validate.ts) derivan de aquí, igual que
// @juicesharp/rpiv-ask-user-question (su `tool/types.ts`). Así el mensaje que
// lee el modelo en la `description` del schema y el límite real que se enforce
// no se desincronizan nunca.

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const MAX_HEADER_LENGTH = 16;
export const MAX_LABEL_LENGTH = 60;

/**
 * Etiquetas reservadas: el modelo NUNCA debe autorizarlas como opciones porque
 * son filas internas / de texto libre gestionadas por el propio tool (paridad
 * con rpiv). Se rechazan en runtime, no como mera convención del prompt.
 *
 * Se incluyen variantes en español y en inglés: aunque el idioma de Frida es
 * español, el modelo puede razonar/escribir en cualquiera, y "Other" /
 * "Type something." son las cadenas con las que el modelo está entrenado.
 */
export const RESERVED_LABELS = [
	"Otro",
	"Escribe algo",
	"Type something.",
	"Other",
	"Next",
	"Siguiente",
] as const;

export type ReservedLabel = (typeof RESERVED_LABELS)[number];

/**
 * Discriminada por `error`: el host emite `details.error` tipado en el resultado
 * del tool en vez de un `string` suelto, para que el modelo reciba un código
 * accionable. (Paridad con el `QuestionnaireError` de rpiv; sin los modos de
 * host `no_ui` / `no_custom_ui` / `session_load_failed` / `stale_module_cache`,
 * que aquí no aplican: Frida es un host único con webview.)
 */
export type QuestionnaireError =
	| "no_questions"
	| "too_many_questions"
	| "duplicate_question"
	| "too_few_options"
	| "duplicate_option_label"
	| "reserved_label";

/** Resultado de `validateQuestionnaire` (pura). */
export type ValidationResult = { ok: true } | { ok: false; error: QuestionnaireError; message: string };
