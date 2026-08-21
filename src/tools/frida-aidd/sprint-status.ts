// frida-aidd — sprint-status single-source-of-truth (issue #38, ADR-0050
// pieza 5). Modelo de datos + writer never-regress para
// docs/aidd/sprint-status.yaml.
//
// Propiedad de corrección (ADR-0050): UN único writer idempotente — el
// orquestador determinista del workflow aidd-ship. Los agentes LLM jamás
// escriben este archivo (el prompt del dev lo prohíbe explícitamente);
// never-regress garantiza que las transiciones jamás regresan un estado
// (done es terminal; blocked/deferred sólo vuelven a pending como re-intento
// o sweep explícitos).
//
// La MISMA lógica corre en el host (tests) y en el sandbox del workflow:
// SPRINT_STATUS_LIB es la fuente única (JS plano, sin imports) que el
// generador embebe en el script. Los tests la ejecutan en un vm real.

/** Estados de una historia. done es terminal (never-regress). */
export const SPRINT_STORY_STATUSES = [
	"pending",
	"in_progress",
	"review",
	"done",
	"blocked",
	"deferred",
] as const;

export type SprintStoryStatus = (typeof SPRINT_STORY_STATUSES)[number];

export interface SprintStory {
	title: string;
	spec: string;
	status: SprintStoryStatus;
	/** Intentos de rework consumidos (review CONCERNS / lie-detector fail). */
	attempts?: number;
	/** Motivo del bloqueo (status=blocked). */
	blockedReason?: string;
}

export interface SprintStatus {
	sprint: string;
	stories: Record<string, SprintStory>;
}

/** Ruta del archivo (relativa al cwd del proyecto). */
export const SPRINT_STATUS_PATH = "docs/aidd/sprint-status.yaml";

/**
 * Lib JS del sandbox: parse/serialize del mini-YAML + tabla de transiciones
 * never-regress. Sin imports, sin template literals (se interpolará dentro de
 * otro template). Formato estricto:
 *
 *   # Escrito por frida-aidd (aidd-ship) — no editar a mano fuera del loop.
 *   sprint: 1
 *   stories:
 *     E1-S1:
 *       title: Exportar CSV
 *       spec: docs/aidd/planning/spec-E1-S1.md
 *       status: done
 *       attempts: 1
 */
export const SPRINT_STATUS_LIB = `
// sprint-status lib (frida-aidd #38) — misma lógica que el host, corre en el
// sandbox del workflow. Formato mini-YAML estricto, 2 espacios de indent.
var SPRINT_STATUS_PATH = "docs/aidd/sprint-status.yaml";
var SPRINT_ORDER = ["pending", "in_progress", "review", "done", "blocked", "deferred"];

// Tabla never-regress: sólo las aristas listadas son legales. done es
// terminal; blocked/deferred sólo re-entran como pending (reintento/sweep).
var SPRINT_EDGES = {
  pending: ["in_progress", "blocked", "deferred"],
  in_progress: ["review", "blocked", "deferred"],
  review: ["done", "in_progress", "blocked"],
  blocked: ["pending"],
  deferred: ["pending"],
  done: []
};

function sprintCanTransition(from, to) {
  if (SPRINT_ORDER.indexOf(from) < 0) return false;
  if (SPRINT_ORDER.indexOf(to) < 0) return false;
  if (from === to) return true; // idempotente
  return SPRINT_EDGES[from].indexOf(to) >= 0;
}

function sprintParseStatus(text, origin) {
  var src = origin || "sprint-status.yaml";
  if (typeof text !== "string") throw new Error(src + ": contenido no-string");
  var sprint = null;
  var stories = {};
  var currentId = null;
  var lines = text.split("\\n");
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!line.trim()) continue;
    if (line.trim().charAt(0) === "#") continue;
    // Indentación estricta: 0 (raíz), 2 (id de historia) o 4 (propiedad).
    var indent = 0;
    while (line.charAt(indent) === " ") indent++;
    if (line.charAt(indent) === "\\t" || indent === 1 || indent === 3 || indent > 4) {
      throw new Error(src + ":" + (i + 1) + ": indentación debe ser 0, 2 o 4 espacios");
    }
    var content = line.slice(indent);
    var m = content.match(/^([A-Za-z0-9_\\-]+):(?:[ ](.*))?$/);
    if (!m) throw new Error(src + ":" + (i + 1) + ": línea no reconocida: " + content);
    var key = m[1];
    var value = m[2] === undefined ? null : m[2];
    if (indent === 0) {
      if (key === "sprint") {
        sprint = value === null ? "" : value;
        continue;
      }
      if (key === "stories") {
        if (value !== null) throw new Error(src + ":" + (i + 1) + ": stories no lleva valor");
        continue;
      }
      // Tolerar baselineCommit y otras claves raíz opcionales
      continue;
    }
    if (indent === 2) {
      if (value !== null) throw new Error(src + ":" + (i + 1) + ": historia no lleva valor inline: " + key);
      if (SPRINT_ORDER.indexOf(key) >= 0) throw new Error(src + ":" + (i + 1) + ": id de historia parece un status: " + key);
      currentId = key;
      stories[currentId] = { title: "", spec: "", status: "pending" };
      continue;
    }
    // indent 4: propiedad de la historia corriente.
    if (currentId === null) throw new Error(src + ":" + (i + 1) + ": propiedad sin historia");
    var story = stories[currentId];
    if (key === "title" || key === "spec" || key === "blockedReason" || key === "baselineCommit") {
      story[key] = value === null ? "" : value;
    } else if (key === "status") {
      var st = value === null ? "" : value;
      if (SPRINT_ORDER.indexOf(st) < 0) throw new Error(src + ":" + (i + 1) + ": status ilegal: " + st);
      story.status = st;
    } else if (key === "attempts") {
      var at = value === null ? "0" : value;
      if (!/^\\d+$/.test(at)) throw new Error(src + ":" + (i + 1) + ": attempts debe ser entero");
      story.attempts = parseInt(at, 10);
    } else {
      // Tolerar propiedades opcionales de metadatos (#93)
      story[key] = value === null ? "" : value;
    }
  }
  if (sprint === null) throw new Error(src + ": falta la clave sprint");
  for (var id in stories) {
    var s = stories[id];
    if (!s.title) throw new Error(src + ": historia " + id + " sin title");
    if (!s.spec) throw new Error(src + ": historia " + id + " sin spec");
  }
  return { sprint: sprint, stories: stories };
}

function sprintSerializeStatus(status) {
  var out = [];
  out.push("# Escrito por frida-aidd (aidd-ship) - unico writer never-regress. No editar a mano fuera del loop.");
  out.push("sprint: " + sprintScalar(status.sprint));
  out.push("stories:");
  var ids = Object.keys(status.stories);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var s = status.stories[id];
    out.push("  " + id + ":");
    out.push("    title: " + sprintScalar(s.title));
    out.push("    spec: " + sprintScalar(s.spec));
    out.push("    status: " + s.status);
    if (s.attempts !== undefined) out.push("    attempts: " + s.attempts);
    if (s.blockedReason !== undefined) out.push("    blockedReason: " + sprintScalar(s.blockedReason));
  }
  return out.join("\\n") + "\\n";
}

function sprintScalar(value) {
  var v = String(value === undefined || value === null ? "" : value);
  if (v === "") throw new Error("sprint-status: valor vacío no serializable");
  // El parser estricto por líneas captura el valor hasta EOL: los ':' en el
  // medio son seguros (razones tipo "lie-detector: claims sin diff: ...").
  // Un valor que INICIA con '#' se comería como comentario → prohibirlo.
  if (v.charAt(0) === "#") throw new Error("sprint-status: valor no puede iniciar con '#': " + v.slice(0, 40));
  if (/[\\r\\n]/.test(v)) throw new Error("sprint-status: valor con salto de línea: " + v.slice(0, 40));
  return v;
}

// Transición never-regress: devuelve un NUEVO status (inmutable) o lanza.
function sprintApplyTransition(status, id, to, reason) {
  var s = status.stories[id];
  if (!s) throw new Error("sprint-status: historia desconocida: " + id);
  if (!sprintCanTransition(s.status, to)) {
    throw new Error("sprint-status: transicion ilegal " + s.status + " -> " + to + " para " + id);
  }
  var next = { sprint: status.sprint, stories: {} };
  var ids = Object.keys(status.stories);
  for (var i = 0; i < ids.length; i++) {
    var k = ids[i];
    var c = status.stories[k];
    next.stories[k] = {
      title: c.title, spec: c.spec, status: c.status,
      attempts: c.attempts, blockedReason: c.blockedReason
    };
  }
  var t = next.stories[id];
  t.status = to;
  if (to === "in_progress" || to === "pending") t.blockedReason = undefined;
  if (to === "blocked") t.blockedReason = String(reason || "sin razón").replace(/[\\r\\n]+/g, " ");
  if (to === "pending") t.attempts = 0;
  return next;
}
`;
