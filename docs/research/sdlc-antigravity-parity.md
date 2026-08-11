# Paridad de Frida con SDLC automatizado (Google Antigravity)

**Tipo:** nota de investigación (no requiere acción de implementación).
**Fecha:** 2026-08-11.
**Fuente:** video *"Automate your entire SDLC with Google Antigravity"* (youtube `K3YYr6yauAw`, ~72 min).
**Transcripción:** extraída vía `yt-dlp` + sesión Brave + `--remote-components` (ver ADR-0049 para el método).
**Complementa:** `graph-engineering-parity.md` (video anterior, barra más alta).

## Resumen

El video demuestra un **SDLC simplificado** con el agente (Antigravity): identificar
el issue (resumir issue + discusión adjunta + status), diseñar (conversación de
Q&A), implementar (clonar/fork/branch, "allow everything", implementar
referenciando un patrón existente, recordar/correr `npm run dev`), y revisar
(review de PR archivo por archivo, cavar a nivel línea bajo demanda). El agente
opera el SDLC con el **humano en control** (cavar a cualquier profundidad,
aprobar).

**Veredicto:** Frida ya hace el **100%** de lo que muestra este video, **hoy**, con
capacidades core. **No hay gaps arquitectónicos** — a diferencia del video de Graph
Engineering. La única oportunidad es **empaquetar** dos flujos repetitivos como
skills/workflows (territorio de #19 y #16), no construir nada nuevo.

## Mapeo Antigravity → Frida

| Capacidad del video | Equivalente Frida | Estado |
| --- | --- | --- |
| Resumir issue/discusión/PR (GitHub) | `bash` + `gh` CLI | ✅ MATCH |
| Conversación de diseño (Q&A) | chat principal del agente | ✅ MATCH (core) |
| Clonar/fork/branch del repo | `bash` (git) + `frida-worktree` (#13) | ✅ MATCH |
| "Allow everything" (permisos) | `frida-permission-system` (modos de aprobación) | ✅ MATCH |
| Implementar referenciando un patrón | read/module_report/symbol_search/pi-lens | ✅ MATCH (core) |
| Recordar comandos ("¿`npm run dev`?") | lee package.json vía `bash` | ✅ MATCH (trivial) |
| Correr el proyecto (`npm run dev`) | `bash` (dev server detached → #24 lo mejora) | ✅ MATCH |
| Review de PR archivo por archivo | `gh pr diff` + skill `code-review` / `pr-triage` | ✅ MATCH |
| Explicación línea por línea | read/read_symbol/read_enclosing/module_report | ✅ MATCH |

## ¿Qué hacer? → Componer, no construir

No hay arquitectura que agregar. La oportunidad es **empaquetar** los flujos
repetitivos como comandos one-shot (en vez de prompting ad-hoc cada vez), todo con
primitivas existentes:

| Flujo del video | Cómo empaquetarlo | Con qué |
| --- | --- | --- |
| **Triage de issue** (resume issue+discusión+status) | workflow o skill `/issue-triage <url>` | `gh` + frida-extensible-workflows o skills (#16) |
| **Review de PR interactivo** (archivo por archivo, "visto", cavar línea) | skill o patrón #19 `pr-review` | skill `code-review`/`pr-triage` + #19 |
| Diseño conversacional | ya es el chat (sin empaquetar) | — |
| Implementación con contexto de fork | ya es el chat + worktree (#13) | — |

Estos son **patrones procedurales** — territorio natural de **#19** (capa de
patrones sobre `frida-extensible-workflows`) y del sistema de **skills** (#16). No
son nuevas extensiones.

## Contraste con el video anterior

| | Graph Engineering (`H7t3uUp3HVw`) | Antigravity SDLC (`K3YYr6yauAw`) |
| --- | --- | --- |
| Barra | Alta (grafos multi-nodo, routing de modelo) | Baja (SDLC lineal, agente único) |
| Gap revelado | ❌ routing de modelo por nodo (#18 → #19) | Ninguno |
| Acción requerida | Desbloquear #18 (token accounting) | Componer flujos (skills / #19) |

## Conclusión

Para replicar este video **no hay que construir nada** — Frida ya lo hace con
capacidades core (chat + bash + gh + read + pi-lens + permission-system +
worktrees). El único valor añadido sería empaquetar los dos flujos repetitivos
(triage de issue, review de PR) como skills/workflows one-command, que cae
naturalmente en **#19** (capa de patrones) y **#16** (sistema de skills). El video,
además, refuerza la **filosofía de Frida**: el agente opera con el humano en
control (checkpoints + permission-system + cavar a cualquier profundidad).

## Referencias

- Fuente: video *"Automate your entire SDLC with Google Antigravity"* (youtube `K3YYr6yauAw`).
- Nota complementaria: `graph-engineering-parity.md`.
- ADR-0022 — `frida-subagents`. ADR-0028 — `frida-extensible-workflows`.
- ADR-0030 — `frida-dynamic-workflows` (capa de patrones #19).
- Skills relevantes: `code-review`, `pr-triage`.
- Issues: **#13** (worktree) · **#16** (skills) · **#19** (patrones) · **#24** (background-tasks).
