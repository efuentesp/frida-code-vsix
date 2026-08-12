# Agent OS — patrones de standards-injection para #21 y #29

**Tipo:** nota de investigación (no requiere acción de implementación).
**Fecha:** 2026-08-12.
**Pregunta:** ¿Qué aporta [`buildermethods/agent-os`](https://github.com/buildermethods/agent-os) que sea neto nuevo para Frida?
**Fuente:** [`buildermethods/agent-os`](https://github.com/buildermethods/agent-os) (MIT, 5.256★, Shell+markdown).

## TL;DR — veredicto

**Agent OS NO es un porte** — ~70% cubierto por el pipeline RPIV (`shape-spec` ⊂
`/skill:design`+`plan`), `annotate-guidance` (estándares curados) y `#38` (spec-first).
Pero aporta **2-3 patrones de UX netos nuevos** que son **inspiración concreta** para
dos extensiones ya planeadas: **`#21` (frida-hermes-memory)** e **`#29`
(frida-knowledge-base)**. Esta nota los registra para que el implementador de #21/#29
los tenga como referencia.

## Qué es Agent OS

Un sistema **ultraligero** (5 slash commands markdown + 3 scripts shell) para dos cosas:

1. **Standards injection** — extraer conocimiento *tribal* del codebase en estándares
   concisos documentados e inyectarlos en el contexto del agente según la tarea.
2. **Spec-driven development** — dar forma a specs (`agent-os/specs/<ts>-<slug>/` con
   plan/shape/standards/references/visuals).

Filosofía rectora: *"Standards will be injected into AI context windows. Every word
costs tokens."* — misma obsesión por concisión que el tiered injection de TEA
(ADR-0053).

## Patrón neto 1 — Injection dispatcher con detección de escenario (→ #21)

El command `inject-standards` es un **dispatcher de contexto** que Frida no tiene
explícitamente:

1. **Detecta el escenario** leyendo la conversación:
   - **Conversation** (implementar código / chat) → lee los estándares al chat.
   - **Creating a Skill** (escribiendo `.claude/skills/`) → output **referencias `@path`**
     (ligero, estándares se mantienen sincronizados) **o** copiar contenido
     (self-contained).
   - **Shaping/Planning** (plan mode / spec) → mismo: referencias o copia.
   - Si ambiguo → `AskUserQuestion` para confirmar (nunca asume).
2. **Lee `index.yml`** (catálogo de estándares con descripción).
3. **Analiza el contexto** (¿API? ¿DB? ¿UI? ¿qué tech?) y **sugiere 2-5** estándares
   relevantes vía `AskUserQuestion`.
4. **Formatea según escenario** — este es el patrón clave: **mismo estándar, 3 formatos
   de salida distintos** según dónde se va a consumir.

**Por qué importa para #21:** el injection hook de hermes hoy es "inyectar X antes del
turn". Agent OS demuestra que el valor está en **detectar el escenario de consumo y
formatear diferenciadamente** (leer vs `@referencia` vs copia). El `@path`-como-referencia
es además un patrón de **economía de tokens**: el estándar vive en un solo sitio y se
referencia, no se duplica en cada skill/spec.

**Receta portable para #21:** al implementar el context-injection hook, añadir
detección de escenario (conversation / skill-authoring / plan) + 3 modos de formato
(inline / `@reference` / embed). El modo `@reference` es el default para mantener
estándares sincronizados sin duplicar contenido.

## Patrón neto 2 — Standards + profiles con herencia (→ #29)

Agent OS modela los estándares como **reutilizables entre proyectos** vía **profiles
con herencia**:

- `profiles/<name>/global/tech-stack.md` — un perfil agrupa estándares por tech-stack
  o equipo (p.ej. `default`, `rails`, `nextjs`).
- `config.yml` define herencia: `profile-b.inherits_from = profile-a` (perfil B
  extiende A sin duplicar).
- `scripts/sync-to-profile.sh` — sincroniza estándares del proyecto de vuelta a un
  perfil base (con backup, conflict-detection, selección interactiva) para reutilizar
  lo aprendido en futuros proyectos.

**Por qué importa para #29:** frida-knowledge-base está pensado como una base de
conocimiento centralizada (los ~65 fragments de TEA, la doc interna). Agent OS añade
el concepto de **perfil reusable con herencia** — el conocimiento no es solo "del
proyecto", es **transferible entre proyectos del mismo stack/equipo**. El
`sync-to-profile` (extraer → perfil base → heredar en el próximo proyecto) es un
patrón de **capitalización del conocimiento** que enriquece #29.

**Receta portable para #29:** soportar `profiles/` con herencia (`inherits_from`) +
un comando/mechanismo de "promover estándar a perfil base" (equivalente a
`sync-to-profile`). Permite que el conocimiento tribal acumulado en un proyecto se
reutilice sin recopilarlo de cero cada vez.

## Patrón neto 3 (leve) — Discover-standards como Q&A colaborativo

`discover-standards` extrae estándares **entrevistando** al usuario (no escaneando
ciego):

- Lee 5-10 archivos representativos del área → identifica patrones *tribales /
  opinionados / consistentes* (no los obvios del framework).
- Presenta hallazgos vía `AskUserQuestion` → usuario selecciona cuáles documentar.
- Para cada estándar: **pregunta el "por qué"** (1-2 preguntas) → espera → draftea →
  confirma → crea archivo. **Un estándar a la vez** (no batch).
- Refuerza concisión: "Lead with the rule", "code examples", "skip the obvious",
  "bullet points over paragraphs".

**Por qué importa:** Frida tiene `annotate-guidance`/`annotate-inline` pero son más
**automáticos** (escanean y generan docs). El modo **Q&A colaborativo** de Agent OS es
un patrón de discovery distinto — capta el *por qué* (tribal) que el escaneo no
encuentra. Podría ser un **modo** de `annotate-guidance`.

**Receta portable:** añadir a `annotate-guidance` un flag `--interactive` que active
el loop Q&A (identificar patrón → preguntar por qué → draftear → confirmar → crear).

## Por qué NO es un porte (extensión separada)

- **`shape-spec`** es un subconjunto del pipeline RPIV (`/skill:design` + `/skill:plan`)
  - `#38` (spec-first). El spec-folder timestamped equivale a `.frida/artifacts/`.
- **Estándares curados markdown** ≈ `annotate-guidance`/`annotate-inline` + AGENTS.md.
- Los 2-3 patrones netos son **capabilities de extensiones ya planeadas** (#21, #29),
  no superficie de dominio nueva (a diferencia de CIS=creatividad, TEA=QA).
- Un porte `frida-agent-os` violaría la política de **no-solapamiento**: duplicaría el
  pipeline de specs y el sistema de estándares.

**Conclusión:** Agent OS es **inspiración de patrones de UX** para `#21`/`#29`, no un
porte. Igual que bmad-loop es "fuente de patrones, no un porte" — pero por la razón
opuesta: bmad-loop porque su motor ya lo tenemos; Agent OS porque su superficie ya la
cubre el roadmap.

## Referencias

- Repo: [`buildermethods/agent-os`](https://github.com/buildermethods/agent-os).
- Issues destino de los patrones: **#21** (frida-hermes-memory — injection dispatcher)
  · **#29** (frida-knowledge-base — standards + profiles con herencia).
- Patrón relacionado: tiered knowledge injection de **TEA** (ADR-0053) — mismo dolor de
  tokens, misma solución de inyección selectiva.
- Serie de research: `bmad-loop-parity.md` · `aidd-bmad-feasibility.md` ·
  `graph-engineering-parity.md` · `sdlc-antigravity-parity.md` ·
  `factory-missions-parity.md` · `adlc-boundary.md`.
