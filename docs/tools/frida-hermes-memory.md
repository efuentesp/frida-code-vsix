# `frida-hermes-memory` (loop de aprendizaje cross-session)

Memoria persistente del agente + loop de aprendizaje estilo *Hermes*: el agente **aprende
de aciertos y errores de múltiples sesiones** sin tocar el modelo. Wrapper del paquete
upstream [`pi-hermes-memory`](https://github.com/chandra447/pi-hermes-memory) (MIT,
chandra447; 732 tests propios) instalado **on-demand** en `~/.frida/npm` — mismo patrón
que `frida-codebase-index` (ADR-0036), pero **passthrough completo**: la factory del
upstream corre contra el `ExtensionAPI` real de la sesión (ADR-0032 D1 — extensión
nativa, no workflow, porque el learning loop necesita los eventos del lifecycle).

## Qué aporta

| Capacidad | Mecanismo |
| --- | --- |
| **Memoria cross-session** | `MEMORY.md` (facts) + `USER.md` (perfil) + memoria por proyecto; two-tier global/proyecto |
| **Inyección de contexto** | Hook `before_agent_start`: memoria relevante → system prompt cada turno (KV-cache-estable, cap ~16K) |
| **Background learning** | Cada 10 turnos / 15 tool calls revisa la conversación y guarda lo notable (sin que lo pidas) |
| **Correction detection** | Cuando corriges al agente, se guarda al instante |
| **Failure memory** | Recuerda qué no funcionó y por qué (con aging: 7 días / 5 entradas inyectadas) |
| **Skills procedurales** | `SKILL.md` generados en un dir propio — contribuidos al sistema de skills de pi (descubribles) |
| **Session search** | SQLite FTS5: busca en sesiones pasadas (`session_search`) |
| **Secret scanning** | Bloquea API keys/tokens antes de persistir |

**Por qué importa:** sin esto, cada sesión de Frida arranca limpia salvo el contexto
vivo. Con esto, el agente no repite errores, no te re-pide preferencias, y su
razonamiento mejora con el uso.

## Comandos y tools

- **Tools**: `memory` (write/read), `memory_search` (FTS5), `session_search`,
  `skill_manage` (skills procedurales).
- **Slash commands** (chat): `/memory-insights` (qué hay guardado),
  `/memory-consolidate`, `/memory-skills`, `/memory-interview` (onboarding),
  `/memory-switch-project`, `/memory-index-sessions` (backfill de sesiones pasadas).

## Instalación y ciclo

1. Primera sesión con el paquete ausente: la tool `memory` responde con la guía
   (modo guía, D6) y Frida **instala en background** `pi-hermes-memory@0.9.5` en
   `~/.frida/npm` (incluye `better-sqlite3` nativo N-API).
2. Al completar, VS Code notifica: ejecuta `/reload` o reinicia la sesión.
3. El learning loop corre solo. Manual: `npm install pi-hermes-memory@0.9.5 --prefix
   "~/.frida/npm" --legacy-peer-deps`.

Storage bajo `~/.frida/` (vía `PI_CODING_AGENT_DIR`): `MEMORY.md`, `USER.md`,
`projects-memory/`, `hermes.db` (FTS5), skills generados. Config opcional:
`~/.frida/hermes-memory-config.json` (defaults del upstream = MVP: policy-only,
review cada 10 turnos / 15 tool calls, correction detection on).

## Gate y costos

- Setting `frida.hermesMemory.enabled` (default `true`).
- **El background learning consume tokens** (llamadas LLM de revisión con
  `completeSimple` sobre las sesiones activas). Desactívalo si prefieres memoria
  puramente manual (las tools siguen disponibles).

## Arquitectura (decisiones clave)

- **Passthrough, no captura**: a diferencia de `frida-codebase-index` (que
  re-registra un subconjunto de tools), aquí la factory del upstream recibe el
  `ExtensionAPI` real — el loop necesita `before_agent_start` (inyección),
  `turn_end` (contadores), `session_shutdown` (flush + index).
- **Entry TS vía jiti**: el upstream distribuye TypeScript fuente
  (`src/index.ts`, manifiesto `pi.extensions`) — se carga con jiti + aliases.
- **Peer-deps via alias**: `--legacy-peer-deps` no instala `pi-ai` /
  `pi-coding-agent`; los aliases de jiti los apuntan a la copia del SDK que Frida
  ya shipea en su VSIX (misma versión, cero duplicación).
- **Main only**: las sesiones hijas de workflow no inyectan memoria ni aprenden.
- **Sin poda de natives**: `better-sqlite3` resuelve su prebuild N-API (ABI-estable,
  node-v115..v131+) al instalar; no hay natives bundled de otras plataformas.

## Tests

`test/frida-hermes-memory/` — `constants.test.ts` (pin/entry/aliases contra el
node_modules real), `installer.test.ts` (idempotencia, ENOENT, exit≠0, timeout),
`wrapper.test.ts` (passthrough con paquete fake cargado por jiti REAL: env var
antes de la carga, `before_agent_start` fluye, alias resuelve `pi-ai` real,
modo guía + instalación background inyectada, entry corrupto degrada sin crash).

## Validación e2e (pendiente — criterio del issue #21)

1. Dev Host → sesión nueva → confirmar la notificación de instalación + `/reload`.
2. Sesión 1: corregir al agente sobre una preferencia ("prefiero respuestas en
   español") y cometer/observar un fallo; `/memory-insights` debe listarlos.
3. Sesión nueva (mismo proyecto): la preferencia debe reflejarse sin re-explicarla;
   preguntar "¿qué recuerdas de este proyecto?".
4. Verificar que `MEMORY.md`/`USER.md` en `~/.frida/` no contienen secrets
   (secret scanning) y que `memory_search` devuelve resultados relevantes.

## Referencias

- Issue [#21](https://github.com/efuentesp/frida-code-vsix/issues/21) · ADR-0032.
- Upstream: `pi-hermes-memory` (npm, MIT) — <https://github.com/chandra447/pi-hermes-memory>
- Patrones reutilizados: `frida-codebase-index` (installer on-demand, modo guía D6),
  `frida-mcp-adapter` (`PI_CODING_AGENT_DIR` → `~/.frida`).
