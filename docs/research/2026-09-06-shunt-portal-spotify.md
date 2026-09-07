# Research: Portal/shunt de Spotify — delegación de I/O para reducir tokens

> Fecha: 2026-09-06 · Contexto: análisis de aplicabilidad a Frida/DevEngine.
> Fuente: [Post de Spotify Engineering](https://engineering.atspotify.com/2026/9/portal-by-spotify-cut-my-claude-code-token-usage-by-90) ·
> [spotify/portal-ai-plugins (shunt)](https://github.com/spotify/portal-ai-plugins/tree/main/plugins/shunt)

## TL;DR

Spotify reporta **82–94% de ahorro de tokens** en lecturas masivas delegando
I/O a modelos baratos ("modes" de Portal/AiKA), con un plugin (`shunt`) de 3
capas: hooks PreToolUse que **bloquean** reads grandes, scripts que delegan, y
skills que guían. **Frida ya tiene ~80% de la infraestructura equivalente**
(roles de modelo F7 con rol `smol`, subagents que corren en él, gate
`tool_call`, skills, y además ventajas que Spotify no tiene: outlines
determinísticos de pi-lens y búsqueda semántica). El hueco principal: el gate
de tamaño de lectura y la enseñanza del patrón.

## Qué hace shunt

| Capa | Mecanismo |
| --- | --- |
| Hooks (duro) | `check-file-size`: bloquea `Read` sin offset/limit de archivos >350 líneas, con reason que redirige. `check-bash-read`: pesca `cat/head/tail/less/more` sobre grandes archivos. Reads dirigidos siempre pasan (para editar). |
| Scripts | `bulk-read --question --paths` (corpus → worker; **jamás entra al contexto de Claude**; follow-ups re-envían "gratis"). `code-write --spec --reference --target`: output directo a disco, **el modelo principal nunca ve el código**. |
| Skills (suave) | 2 SKILL.md enseñan cuándo derivar. Degradación elegante: el hook protege aunque la skill no se lea. |

## Límites documentados (respetar en cualquier porte)

1. **No delegas edición**: los resúmenes del worker no traen números de línea
   confiables → para editar hay read dirigido (offset/limit).
2. **No delegas razonamiento**: el worker se pierde bugs sutiles; debugging,
   arquitectura y código safety-critical quedan fuera del routing.
3. **Latencia**: 10–30 s por round-trip a Portal → el umbral existe porque
   delegar lecturas pequeñas cuesta más de lo que ahorra. (En frida con
   subagents in-process + Ollama local este límite casi desaparece.)

## Mapeo a Frida

| Capa shunt | Equivalente Frida | Estado |
| --- | --- | --- |
| Mode (worker barato) | Rol `smol` de F7 (#121) → Ollama (costo 0) | ✅ cableado (`pi-session.ts` crea hijas con `childModel` smol) |
| Delegación | frida-subagents (#26): tool `Agent` con override de modelo | ✅ el corpus vive en la ventana del hijo |
| PreToolUse | Gate `tool_call` de frida-permission-system | ✅ punto de decisión (capas de patrones añadidas en #196) |
| Skills | SKILL.md + frida-multi-skills | ✅ |
| — | **pi-lens** `module_report`/`read_symbol`/`read_enclosing` | ✅ ventaja exclusiva: outline determinístico, 0 tokens, 0 latencia |
| — | frida-codebase-index (#25): semántica + call graph | ✅ |
| — | frida-context + session-stats/usage | ✅ telemetría para medir el ahorro |
| Gate de tamaño de lectura | — | ❌ hueco principal |
| Skills de delegación | — | ❌ nadie enseña el patrón |
| Benchmark de ahorro | — | ❌ (metodología shunt: chars/4, fixtures, before/after) |

## ¿Frida o DevEngine?

- **Decisión de routing → Frida**: sólo el harness ve la semántica del tool
  (path, offset, tamaño). Un gateway ve prompts opacos.
- **Ejecución del worker → Frida hoy** (subagent + smol). Portal suma 10–30 s
  de round-trip; in-process local casi no.
- **Registry de "modes" (con nombre, fork con shadowing) → DevEngine, opcional
  (producto)**: reuso cross-tool Softtek + gobernanza del gasto. Frida captura
  ~90% del valor sin esto.
- **Sumarización transparente en el gateway → riesgosa**: pierde números de
  línea (rompe edición); sólo el harness puede compensar con reads dirigidos.

## Propuestas priorizadas

1. **P1 `frida-shunt`**: gate de lecturas costosas (read sin offset/limit > N
   líneas + bash cat/head/tail sobre grandes archivos) con reason que enseña
   la escalera: pi-lens (estructura) → subagent smol (pregunta profunda) →
   read dirigido (edición). + 2 skills globales (bulk-reader, code-writer con
   escritura directa a disco). Interacciones a diseñar: precedencia con
   permission-system/TTSR en el bus `tool_call`; el reason debe siempre
   ofrecer la ruta de edición (anti-loop).
2. **P2 benchmarks de ahorro** (4 escenarios con fixtures, chars/4,
   before/after con session-stats).
3. **P3 modes en DevEngine** (producto, sólo si el patrón despega).

## Sinergias con el roadmap

- **F10 hashline**: el otro eje del mismo pilar — shunt optimiza *input*
  (lecturas) y delega generación; hashline abarata la generación que sí hace
  el modelo principal (−61% output). Dupla de facturación.
- **F8 advisor**: ya consume la misma infraestructura (smol por turno).
- **#23/#31 compresión**: versión post-hoc del mismo objetivo; el gate es
  preferible (evita el gasto en vez de comprimirlo).
