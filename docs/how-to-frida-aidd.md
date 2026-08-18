# How-to: AiDD — de la idea al sprint autónomo (frida-aidd)

> Normalmente tú diriges cada paso: "hazme el PRD", "ahora la arquitectura",
> "ahora implementa la historia 3, luego la 4…". **AiDD** (Agile AI-Driven
> Development, metodología BMAD adaptada) invierte eso: das la idea una vez y
> Frida corre **toda la cadena de planificación** y luego un **sprint
> autónomo** donde cada historia pasa dev → verificación → review → commit —
> con frenos que detectan cuando el agente *afirma sin hacer*.
>
> Referencia técnica: [docs/tools/frida-aidd.md](tools/frida-aidd.md) · ADR-0050.

## El modelo en 30 segundos

```text
Fase 1 (plan):   "corre aidd-plan: módulo de reportes exportables"
  brief.md → checkpoint → prd.md → checkpoint → architecture.md → checkpoint
  → epics-and-stories.md → spec-E1-S1.md ‖ spec-E1-S2.md ‖ …   (fan-out)

Fase 2 (ship):   "corre aidd-ship"
  por cada historia: dev escribe código → lie-detector (diff REAL vs lo
  reclamado) → review adversarial → verify (comandos del spec)
  → checkpoint → commit del orquestador → sprint-status: done
  al final: sweep de lo diferido
```

- **Todo queda en tu repo** como markdown auditable y versionado
  (`docs/aidd/**`) — nada vive sólo en la conversación.
- **El orquestador es determinista**: el flujo, el estado y los commits los
  decide un script, no el LLM. Los agentes son desechables.
- **Tú apruebas** cada artefacto y cada commit (o corres con `review: "auto"`).

## Cuándo usarlo (y cuándo no)

**Úsalo para**: un feature o producto completo que merece especificación antes
de codificar — de la idea vaga a historias implementadas sin que tú seas el
bucle entre pasos.

**No lo uses para**: una tarea puntual (`frida-goal` la persigue hasta
terminarla), análisis de ángulos múltiples (un `workflow` tipo code-review), ni
proyectos donde la especificación previa no aporta (spikes, prototipos).

## Fase 1 — plan

```text
Tú:        "corre aidd-plan: módulo de reportes exportables para el panel"
Frida:     brief.md listo → ⏸ checkpoint: revisa/edita y aprueba
           prd.md listo → ⏸ checkpoint → architecture.md → ⏸ checkpoint
           → épicas e historias → specs (una por historia, en paralelo)
```

| Arg | Qué |
| --- | --- |
| `idea` | tu idea, verbatim (único obligatorio) |
| `language` | idioma de los artefactos (default: el de la idea) |
| `review: "auto"` | corre sin checkpoints (todo de un jalón) |

**Entre checkpoints puedes editar los archivos a mano** — el stage siguiente
lee el artefacto del disco, no la memoria del agente anterior. Si algo no se
puede fundamentar, el agente lo taggea `[ASSUMPTION]` y deja las preguntas
abiertas dentro del documento.

## Fase 2 — ship

```text
Tú:        "corre aidd-ship"
Frida:     E1-S1: dev → lie-detector ✅ → review ✅ → verify ✅
           → ⏸ checkpoint de commit → feat(aidd): E1-S1 — …
           E1-S2: … (así por cada historia)
           sweep: empaqueta lo diferido no bloqueante → mini-stories → listo
```

| Arg | Qué |
| --- | --- |
| `review: "auto"` | sin checkpoint pre-commit (default: `manual`) |
| `maxSweeps: N` | máx. rondas del sweep (default 2, máx 5) |
| `sprint: "2"` | etiqueta del sprint (sólo si arranca de cero) |

Sin artefactos previos hace bootstrap desde los de `aidd-plan`. **Requiere
repo git.**

## Las redes de seguridad (por qué no se desborda)

| Guard | Comportamiento |
| --- | --- |
| **Lie-detector** | El dev reclama `filesTouched`; el orquestador los contrasta contra el **diff real de git** — reclamar archivos que no cambió → rework → `blocked` |
| **Frozen-spec** | El hash del spec se congela al iniciar la historia; si el dev lo editó para "mover la portería" → `blocked` |
| **Sprint-status never-regress** | Estado en `docs/aidd/sprint-status.yaml` con único writer: `done` es terminal, nadie "des-done" |
| **Review acotado** | Un reviewer adversarial por historia (máx. 1 ronda de fix); CONCERNS persistentes → `blocked` con las notas |
| **Verify determinista** | Los comandos del spec corren tal cual; un exit ≠ 0 → `blocked` |
| **Checkpoints** | Cada commit pide tu aprobación (`review: manual`); rechazar deja la historia `blocked` con razón |
| **Deferred-work** | Impedimentos NO bloqueantes van al ledger y la historia sigue; el sweep los atiende al final |

Las historias `blocked` quedan con su razón en `sprint-status.yaml` — tú decides
si corregir a mano y relanzar (`blocked → pending` es la única re-entrada).

## Recetas

```text
"corre aidd-plan: onboarding guiado de 3 pasos para usuarios nuevos" review auto
"corre aidd-ship"                          # con checkpoints por commit (default)
"corre aidd-ship con review auto y maxSweeps 0"   # sin pausas, sin sweep
"revisa docs/aidd/sprint-status.yaml"      # ¿cómo va el sprint?
"desbloquea E1-S2 y relanza aidd-ship"     # tras corregir a mano
```

## Customizar los prompts (3 capas)

Sin tocar la extensión: crea `.frida/aidd/stages.json` en el repo (equipo) o
`~/.frida/aidd/stages.json` (personal) con el prompt completo de cualquier
stage:

```json
{ "stages": { "prd": "# PRD — variante del equipo\n…" } }
```

Gana la capa más profunda (defaults → equipo → usuario).

## Límites honestos

- El lie-detector verifica **qué archivos** cambiaron, no la semántica del
  cambio — eso es trabajo del reviewer.
- El verify depende de que el spec tenga comandos reales; sin ellos, esa
  barrera se reduce a review.
- El sweep empaqueta lo que el triage considere resolvible; lo que necesita
  decisión humana queda abierto en el ledger.
- `review: "auto"` te quita del loop por completo — úsalo cuando confíes en
  los specs y quieras el sprint desatendido.
- Los sub-agentes heredan tus gates de permisos normales para bash.
