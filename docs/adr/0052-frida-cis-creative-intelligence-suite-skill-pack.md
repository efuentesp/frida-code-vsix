# `frida-cis` — Creative Intelligence Suite como skill pack (porte de `bmad-module-creative-intelligence-suite`)

**Estado:** aceptado (#40). **Bloqueado por #38** (`frida-aidd` — aporta la
customize-layer que este ADR reusa sin duplicar).

Se porta como **skill pack** el módulo BMAD *Creative Intelligence Suite* (CIS) — 10
skills (6 agentes creativos + 4 workflows) para el *fuzzy front-end*: ideación, design
thinking, problem-solving, innovación, storytelling y presentaciones. Sigue el **camino
A (porte nativo de contenido)** del ADR-0050: cero dependencias npm nuevas, contenido
portable (MIT), misma mecánica de skill que `frida-aidd` (#38) y
`frida-advise-project-approach` (#34).

## Contexto

[`bmad-code-org/bmad-module-creative-intelligence-suite`](https://github.com/bmad-code-org/bmad-module-creative-intelligence-suite)
(v0.2.1, MIT, 174★, `dependencies: null`) es un **módulo BMAD** que aporta:

| Tipo | Skills | Mecánica |
| --- | --- | --- |
| **Agent (6)** | Storyteller (Sophia), Design Thinking (Maya), Brainstorming (Carson), Problem Solver (Dr. Quinn), Innovation (Victor), Presentation (Caravaggio) | Persona fija + menú de capacidades → dispatchan a workflows |
| **Workflow (4)** | `problem-solving`, `design-thinking`, `innovation-strategy`, `storytelling` | N pasos (`<step>`) con `<template-output>` + `<energy-checkpoint>`, catálogo CSV de técnicas, `template.md` de output |

Cada skill sigue un protocolo de activación de 7-8 pasos. La pieza central es el
**customize layer de 3 niveles**: un resolver lee 3 archivos TOML en orden base → team →
user (`{skill-root}/customize.toml` ← `_bmad/custom/{skill}.toml` ←
`_bmad/custom/{skill}.user.toml`) y aplica un merge estructural (escalares sobreescriben,
tablas deep-merge, arrays append, arrays-de-tablas con `code`/`id` reemplazan+añaden).
Config compartida en `_bmad/cis/config.yaml` (`user_name`, `communication_language`,
`output_folder`).

### Dependencia que se ELIMINA: `uv`/Python

El resolver es **Python** (`uv run _bmad/scripts/resolve_customization.py`, Python ≥3.11)
— rompería la regla de proyecto *"sin deps externas que el usuario no pueda instalar"*
(entorno corporativo). **Pero** el `SKILL.md` trae el fallback explícito:

> *"If the script fails, resolve the block yourself by reading these three files in
> base → team → user order and applying the same structural merge rules."*

→ El customize layer es **replicable sin Python**: el LLM lee los 3 TOML y mergea, **o**
se porta el resolver a una **tool TS determinista** (`frida-customize`). Esta capability
es **compartida con `frida-aidd` (#38)** — mismo BMAD customize layer — por lo que su
construcción no es coste marginal de CIS.

## Decisión

**Porte nativo de CIS como skill pack `frida-cis`, reusando la customize-layer de
`frida-aidd` (#38), sin Python.**

| ID | Decisión | Justificación |
| --- | --- | --- |
| **D1** | **Porte de contenido (camino A).** Los 10 skills (`SKILL.md` + `*.csv` + `template.md` + `customize.toml`) se portan a `~/.pi/agent/skills/frida-cis-*` (o `src/skills/` empaquetados). MIT. | Mismo modelo que ADR-0050 (frida-aidd) y ADR-0045 (#34). Cero deps npm. |
| **D2** | **Customize-layer reusada de #38 (no duplicada).** El resolver 3-niveles (sub-cap de #16) lo construye `frida-aidd`; `frida-cis` lo consume. | CIS y AiDD son **el mismo** BMAD customize layer — dos consumidores validan la capability. `frida-cis` no reimplementa el resolver. |
| **D3** | **Eliminar `uv`/Python.** El resolver Python se sustituye por: (a) **LLM-resolver** (instrucción en el `SKILL.md` — el fallback ya existe), **o** (b) **tool TS** `frida-customize` (determinista, reusada por #38). Decisión final en la implementación de #38. | Regla de proyecto: sin deps externas instalables por el usuario. |
| **D4** | **Overlap con skills de presentación → consolidar.** `html-presentation` + `presentation-design` se absorben en el agente **Presentation Master** (Caravaggio) de CIS. Un solo skill de presentaciones, no tres. | Elimina redundancia. Presentation Master ya cubre arquitectura (Duarte) + diseño gráfico (Saul Bass). |
| **D5** | **Dominio = fuzzy front-end (complementario, no redundante).** CIS cubre ideación/negocio *antes* del pipeline técnico: `/cis-problem-solve` o `/cis-brainstorm` alimentan a `/skill:discover`. | No solapa con RPIV (discover→…→commit) ni con `frida-aidd` (metodología de desarrollo). Es la capa de creatividad que falta. |
| **D6** | **Config `_bmad/cis/config.yaml` → config Frida.** `user_name`, `communication_language`, `output_folder` viven en `.frida/cis/config.json` (o settings VS Code), no en `_bmad/`. | ADR-0010 (`~/.frida`). |
| **D7** | **Descartar infraestructura no-Frida.** `npx bmad-method install`, `.claude-plugin/marketplace.json`, website Astro, `.husky` → no se portan. Frida tiene su propio sistema de skills (`/skill:discover`, `~/.pi/agent/skills/`). | No aplica a VS Code / Pi. |

## Mapeo de componentes

| Componente CIS | Equivalente Frida | Origen |
| --- | --- | --- |
| 10 skills (`SKILL.md` + `CSV` + `template.md`) | Porte directo | ✅ contenido MIT |
| `customize.toml` + resolver 3-niveles | **Capability de #38** (LLM-fallback o tool TS `frida-customize`) | ❌ bloqueado por #38 |
| `_bmad/cis/config.yaml` | `.frida/cis/config.json` (D6) | parcial |
| `_bmad/scripts/resolve_customization.py` | eliminado (D3) | ❌ sin Python |
| `/cis-*` slash commands | `/skill:cis-*` | ✅ automático |
| `module.yaml` (agent roster + `visual_tools`) | doc de metadatos + roster distribuido en skills | parcial |
| `.claude-plugin/marketplace.json` | descartado (D7) | N/A |
| `html-presentation` + `presentation-design` (Frida) | absorbidos por Presentation Master (D4) | consolidación |

## Alternativas consideradas

- **A — CIS como expansión de `frida-aidd` (#38), no extensión separada.** Descartado
  (pero cercano): aunque comparten el customize-layer, los **dominios son distintos**
  (creatividad ≠ metodología de desarrollo). Mantenerlos separados deja a CIS
  instalable/opcional sin arrastrar todo AiDD. Se reevalúa si la línea se difumina.
- **B — Mantener el resolver Python (`uv`).** Descartado: rompe la regla de proyecto
  *"sin deps externas"*. El LLM-fallback del propio SKILL.md lo hace innecesario.
- **C — No portar Presentation Master (dejar html-presentation + presentation-design).**
  Descartado: Presentation Master es **más capaz** (arquitectura + diseño + entrega) y D4
  elimina redundancia.

## Consecuencias

**Positivas**

- 10 skills de creatividad en Frida (8 netos nuevos tras consolidar presentaciones).
- **2do consumidor** de la customize-layer de #38 → valida y amortiza esa capability.
- Capa de fuzzy front-end que complementa el pipeline RPIV y `frida-aidd`.
- Cero deps npm; sin Python.

**Negativas**

- **Bloqueado por #38** (customize-layer) y, indirectamente, por #16 (skill system).
- Migración del config BMAD (`_bmad/`) → Frida (`.frida/`) requiere adaptar los
  placeholders `{project-root}/_bmad/...` de los SKILL.md porteada.
- Consolidación de presentation skills (D4) es un refactor con impacto en usuarios
  actuales de `html-presentation`.

## Puntos frágiles

- **Merge TOML no-determinista vía LLM** (opción a de D3): si se elige el LLM-resolver,
  el merge puede divergir entre runs. La **tool TS** (opción b) es preferible para
  determinismo — decisión final en #38.
- **`{project-root}/_bmad/...` paths** en los SKILL.md porteada: hay que reescribirlos a
  `.frida/cis/...` o el resolver Frida los interpretará mal.
- **`visual_tools` prompt** (mermaid/excalidraw/gemini-nano): CIS asume generador de
  imágenes; Frida debe mapear esto a su config de Mermaid/sin generador de imágenes.

## Referencias

- Issue **#40**.
- **ADR-0050** (`frida-aidd`) — camino A (skill pack); CIS sigue el mismo modelo.
- **#38** (`frida-aidd`) — **bloqueo directo**: aporta la customize-layer que D2 reusa.
- **#16** (skill system) — **bloqueo indirecto**: sub-cap del resolver 3-niveles.
- **ADR-0045** / **#34** (`frida-advise-project-approach`) — skill de metodología,
  patrón de skill pack precedente.
- `html-presentation` + `presentation-design` skills → consolidación (D4).
