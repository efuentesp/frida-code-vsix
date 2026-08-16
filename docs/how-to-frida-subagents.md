# How-to: frida-subagents — subagentes autónomos (foreground · background · detached)

> **frida-subagents** (#22/#26) le da al agente la capacidad de **delegar**: lanza
> sub-agentes autónomos con contexto propio, herramientas especializadas y modos
> de ejecución que cubren desde "respóndeme ya" hasta "trabaja toda la noche
> aunque yo cierre todo". Este manual te lleva por los tres modos, cuándo usar
> cada uno y cómo auditar lo que hicieron.
>
> Referencia técnica: [docs/tools/frida-subagents.md](tools/frida-subagents.md) ·
> ADR-0022 · ADR-0037.

## Los tres modos en 30 segundos

```
foreground   →  resultado inline, bloquea el turno del agente
background   →  devuelve ID al instante, notifica al completar
detached 🛰  →  PROCESO propio: sobrevive /reload, cierre de VS Code, reinicio
```

| Modo | ¿Bloquea el chat? | ¿Sobrevive cerrar VS Code? | Úsalo para |
| --- | --- | --- | --- |
| foreground | **sí** | no | "busca esto y dime" — resultado inmediato |
| background | no | no (muere con la sesión) | paralelismo DENTRO de la sesión actual |
| **detached** | no | **sí** (proceso OS propio) | tareas largas: auditorías, migraciones, reviews completas |

La regla mental: **background vive mientras tu sesión; detached vive mientras
tu computadora.**

## Casos de uso clásicos

### 1. La pregunta puntual (foreground)

```
Tú:   busca en el código dónde se valida el token de sesión y dime el archivo exacto
```

El agente despacha un subagente foreground, espera su respuesta y te la entrega
inline. Coste: el turno del agente se bloquea mientras el subagente trabaja.

### 2. Paralelismo en la sesión (background)

```
Tú:   mientras sigues con el fix, manda en background un agente que
      investigue cómo migrar el store a zustand
```

```
Agent({ subagent_type: "general-purpose",
        description: "investigar zustand",
        prompt: "…", run_in_background: true })
→ "Agente spawnado en background (ID: …). Te notificaré al completar."
```

El chat queda libre; al completar, notificación agrupada (si hay varios,
llegan juntos). Consulta el estado con `get_subagent_result` o espera el aviso.

### 3. La auditoría de toda la noche (detached — el caso bandera)

```
Tú:   lanza un subagente detached que audite todo src/ en busca de
      manejo inseguro de secrets y me deje un reporte — tómate tu tiempo
```

```
Agent({ subagent_type: "Explore", detached: true,
        description: "auditoría secrets", prompt: "…" })
→ 🛰 Detached det-1 spawnado (PID 8412, proceso propio —
  sobrevive a esta sesión y a un reinicio de VS Code).
```

Ahora viene lo importante: **cierra VS Code y vete a casa**. El subagente
sigue corriendo en su proceso. Mañana abres Frida y:

- el **widget footer** muestra `🛰 auditoría secrets · turn 23 · 41.2k tok` en vivo;
- `/detached` abre el panel con la ficha: prompt completo, último texto,
  actividad actual, Detener;
- si ya terminó, el resultado quedó persistido en el **Histórico** del panel
  (y en `get_subagent_result("det-1")` desde el chat).

### 4. Detener un detached

```
/detached stop det-1
```

O desde el panel: selecciona el run → **Detener** → segunda ⏎ confirma
(SIGTERM a todo el grupo de procesos; el estado queda `killed` en el registro
durable).

## Los agentes disponibles

| Tipo | Para qué | Aislamiento típico |
| --- | --- | --- |
| `general-purpose` | tareas multi-paso generales (hereda el system prompt del padre) | — |
| `Explore` | búsqueda **read-only**: "dónde está X", mapas de código | ideal detached |
| `Plan` | diseñar planes de implementación antes de tocar código | — |
| **Custom** (`.frida/agents/*.md`) | tus especialistas con prompt propio | configurable |

Los custom agents se descubren de `.frida/agents/` (proyecto) y
`~/.frida/global/agents/` (global) — un archivo `.md` con frontmatter define
prompt, tools permitidas, modelo e incluso `isolation: worktree`.

## Aislamiento: cuándo worktree, cuándo sandbox, cuándo detached

Frida tiene tres capas de aislamiento que **se combinan**:

| Capa | Qué aísla | Cómo se pide |
| --- | --- | --- |
| **worktree** | archivos (branch propio por agente) | `isolation: "worktree"` en el custom agent |
| **detached** 🛰 | el proceso (sobrevive al padre) | `detached: true` al lanzar |
| **sandbox** (#35) | la computadora completa (Docker) | pide "en un sandbox" — ver [how-to-sandboxes](how-to-frida-sandboxes.md) |

Ejemplo compuesto: *"audita el branch X en un worktree, detached, y en un
sandbox"* — archivos, proceso y máquina aislados a la vez.

## Receta completa (paso a paso)

```
Tú:   quiero saber si el módulo de pagos tiene race conditions.
      Lanza un detached Explore que lo analice a fondo.

Agente: [Agent detached → det-1]
        🛰 Detached det-1 spawnado (PID 8412)

  … (una hora después, o mañana) …

Tú:   ¿cómo va lo de pagos?

Agente: [get_subagent_result("det-1")]
        Estado: running · turn 23 · 41.2k tok · escribiendo…
        Sigue corriendo en su propio proceso.

Tú:   /detached          ← ojo al widget footer: 🛰 pagos · turn 23

  … (al completar: notificación "✓ Detached det-1 (pagos) completó · 58k tok") …

Tú:   muéstrame el resultado del detached

Agente: [get_subagent_result("det-1")]
        Resultado: «Encontré 2 race conditions: … (reporte completo)»
```

## Panel /detached

```
┌ [Activos 1] [Histórico 4]                     [⟳] [X] ┐
│ 🔍 [Filtrar runs___________________________]           │
│  ❯ 🛰 pagos   Explore   t23 · 41.2k tok · escribiendo  │
│    🛰 docs    general   ✓ completado                   │
│───────────────────────────────────────────────────────│
│  pagos · det-1 · PID 8412 · corriendo 1h 12m          │
│  Modelo devengine/gpt-5.4-mini · Explore              │
│  [Detener]  (⏎ confirma · Esc cancela)                │
│                                                        │
│  Prompt: «quiero saber si el módulo de pagos tiene…»   │
│  Último texto: «…analizando transfer.go L148…»         │
└────────────────────────────────────────────────────────┘
```

↑↓ navega · ⏎ detiene (segunda ⏎ confirma) · Esc cierra. El panel también
sobrevive reinicios: los runs se leen del registro durable en
`~/.frida/detached/`.

## Límites honestos del MVP detached

- **Sin steer**: no puedes mandarle mensajes a un detached que ya corre
  (necesita modo rpc; el tool te lo dice en vez de fingir).
- **Sin max_turns** en detached (Detener es el límite manual).
- **Tokens contabilizados** (#18): el consumo del detached se acumula desde su
  log y se reporta en la notificación y el panel.
- **Composición in-sandbox** (#35): seguimiento del ADR-0047 — hoy detached y
  sandbox se usan por separado.

## Buenos hábitos

1. **`description` siempre** — es lo que verás en el widget, el panel y las
   notificaciones; sin ella, todo dice "general-purpose".
2. **Detached para lo que de verdad tarda** — cada detached es un proceso con
   su sesión; no lo uses para búsquedas de 30 segundos (background basta).
3. **Audita con `/detached`** — prompt completo y último texto quedan en la
   ficha; "trust but verify" aplica igual a subagentes.
4. **Explora los customs** — `.frida/agents/auditor.md` con
   `isolation: worktree` + detached es tu auditor nocturno listo cada noche.

## Relación con el resto de Frida

- **worktrees** (#13/#14): el aislamiento de archivos que detached puede usar —
  [how-to-frida-worktrees](how-to-frida-worktrees.md).
- **sandboxes** (#35): la computadora aislada —
  [how-to-frida-sandboxes](how-to-frida-sandboxes.md).
- **extensible-workflows**: `parallel()` ya es detached dentro de workflows;
  esto lo lleva a subagentes ad-hoc sueltos.
