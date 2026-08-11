# Extensión `frida-headroom`: compresión de contexto opt-in vía proxy (complemento de #23)

**Estado:** aceptado (#31).

## Contexto

La compresión de contexto (antes de llegar al LLM) es una de las palancas de mayor impacto en costo y
ventana de los agentes: [Headroom](https://github.com/headroomlabs-ai/headroom) (Apache-2.0, 66k stars)
reporta **60–95% menos tokens en JSON, 15–20% en code agents**, con las mismas respuestas (GSM8K
±0.000, TruthfulQA +0.030, SQuAD 97%, BFCL 97%). Su pipeline `CacheAligner → ContentRouter → CCR`
combina compresores **content-aware**: SmartCrusher (JSON, estadístico), CodeCompressor (AST vía
tree-sitter) y Kompress-v2-base (texto, modelo ML de HuggingFace). Además ofrece reducción de
**output** (verbosity + effort routing), **CCR** reversible (originales cacheados), **cross-agent
memory** y `headroom learn` (minado de sesiones fallidas → correcciones a `AGENTS.md`).

Hay dos audiencias/complejidades:

- **`#23 frida-hypa`** (ADR-0034) ya decidió una línea base **nativa TS, 0 dependencias, determinista**
  (siempre disponible, ganancias modestas).
- **Headroom** ofrece compresión **content-aware muy superior**, pero **requiere un runtime Python**
  (el proxy corre los compresores; Kompress necesita PyTorch).

**Hecho técnico crítico:** el SDK npm `headroom-ai` (0 deps) es un **cliente del proxy**, NO un
compresor nativo — `compress()` → `HeadroomClient.compress()` → HTTP al proceso Python (su docstring
dice *"using the Headroom proxy"*). Los compresores reales viven en Python. No existe vía
TS-standalone. Por tanto Headroom **no puede sustituir** a `#23` (que es nativo): son **complementarios**.

El ecosistema pi ya tiene **4 extensiones** de headroom — **todas proxy-based**
(`@jmcombs/pi-headroom` 2.0.0, `@rsrini/pi-headroom`, `@ryan_nookpi/pi-extension-headroom`, `pi-headroom`)
— confirmando que el patrón viable es **proxy mode**. La referencia más madura es `@jmcombs` 2.0.0, que
implementa **passthrough graceful** cuando el proxy no responde.

## Decisión

**D1 — Extensión nativa `frida-headroom` = integración opt-in del proxy de Headroom (NO es un porte,
NO es nativo).** Frida **redirige el `baseURL` del provider activo** → `http://127.0.0.1:8787` (proxy
local). El proxy comprime y reenvía al provider real (compatible OpenAI `/v1/chat/completions` y
Anthropic `/v1/messages`). **Cero código de compresión en Frida.** Módulo: `src/tools/frida-headroom/`.

**D2 — Complemento de `#23 frida-hypa`, no reemplazo.** `#23` queda como **baseline nativa siempre
disponible** (0 deps, determinista). `frida-headroom` es **modo power opt-in** (Python + ML, 60–95%).
Coexisten: el usuario elige según tenga Python o no.

**D3 — Toggle con *capability gating* (4 estados).** El interruptor siempre existe (descubrible) pero
su estado depende de la detección de **Python ≥3.10 + `headroom` + health del proxy** — así nunca rompe
una sesión activándolo sin dependencias. Sin fallo silencioso.

| Estado | Python+headroom | UI | Comportamiento |
| --- | --- | --- | --- |
| No disponible | ausente | ⚫ deshabilitado + tooltip | Guía de instalación inline |
| Listo (off) | presente | ⚪ habilitado, off | Sin compresión (default) |
| Activo | presente + proxy corriendo | 🟢 on | `baseURL` → proxy + card de ahorros |
| Degradado | presente + proxy caído | 🔴 on + warning | passthrough transparente |

**D4 — Sin Python: toggle deshabilitado + guía, no auto-instalación.** Detectar `uv`; si existe, botón
**Instalar** corre `uv tool install headroom-ai[all]` en la **terminal integrada** (visible,
cancelable). Sin `uv`, mostrar el comando `pip`. *Nunca* `pip` global silencioso. Principio: **guiar,
no instalar en segundo plano**.

**D5 — Passthrough graceful.** Si el proxy cae a mitad de sesión → Frida envía directo al provider +
badge de warning, sin abortar (estado Degradado). "On" es siempre seguro: en el peor caso, no comprime.
Patrón de `@jmcombs/pi-headroom` 2.0.0.

**D6 — Ciclo de vida del proxy híbrido.** Frida ofrece comando **"Iniciar/Detener proxy"** (spawn) **y**
detecta uno externo ya corriendo (health-check). Flexibilidad sin acoplar el proceso al ciclo de vida
de Frida/VS Code.

**D7 — Detección de capability.** `python3 --version` (≥3.10, fallback `python`) · `headroom --version`
(o `uv tool list`) · `GET http://127.0.0.1:8787/health` (sólo si toggle on). Re-comprobar al tocar el
toggle y periódicamente mientras está activo.

**D8 — Complemento MCP opcional + card de ahorros.** Vía `frida-mcp-adapter`: `headroom_stats`
(ahorros) y `headroom_retrieve` (CCR — recuperar originales). Card de ahorros en el webview alimentada
por `headroom_stats` → sinergia con **#18** (token accounting). `headroom learn` y cross-agent memory
quedan **fuera del MVP** (overlap parcial con `#21`/`#22`; evaluar después).

**D9 — Cero conflicto.** Opt-in, default off. Ortogonal a `#23` (baseline nativa) y a `frida-context`
(mide presión; headroom la reduce). Apache-2.0 (compatible).

## Alternativas consideradas

- **A — Porte nativo TS de los compresores.** Descartado: el SDK TS es **cliente del proxy** (no
  nativo); portear SmartCrusher/AST/Kompress-ML es enorme y Kompress necesita PyTorch (imposible en TS).
- **B — Headroom sustituye a `#23 Hypa`.** Descartado: rompe la filosofía TS-sin-Python de Frida y
  gatearía toda compresión tras Python. `#23` es la baseline siempre disponible.
- **C — MCP-only (`headroom_compress` explícito).** Descartado como primario: la compresión explícita
  como tool del agente es incómoda (debería ser transparente). Se mantiene como **complemento opcional**
  (D8: stats/retrieve).
- **D — Instalar `pi-headroom` directo en `~/.frida` (ADR-0005).** Viable como PoC, pero sin UI VS Code:
  sin toggle con capability gating, sin guía de instalación, sin card de ahorros en el webview.

## Consecuencias

**Positivas**

- Ahorros grandes (60–95%) **opt-in**, sin forzar Python a todos los usuarios (`#23` sigue como base).
- **Nunca rompe sesiones** (passthrough graceful + toggle gated).
- **Descubrible + guiado** (toggle siempre visible; instalación a un clic).
- Cero código de compresión en Frida (delegado al proxy maduro).

**Negativas**

- El modo power **requiere Python** del usuario + instalar `headroom-ai` (+ PyTorch para Kompress).
- Frida debe gestionar el **ciclo de vida del proceso proxy** (spawn/health) y el **redirect del
  `baseURL`** del provider (verificar compatibilidad por provider).
- El proxy añade un **hop local** (latencia mínima) y la compresión ML tiene coste de cómputo.
- `headroom learn`/memory **no se integran** en el MVP (coordinar con `#21`/`#22` después).

## Referencias

- Issue **#31**.
- Upstream: <https://github.com/headroomlabs-ai/headroom> (Apache-2.0) · `headroom-ai` (PyPI/npm).
- Referencia pi: `@jmcombs/pi-headroom` 2.0.0 (patrón proxy + passthrough graceful).
- SDK TS: `headroom-ai` (npm) — **cliente del proxy**, no nativo.
- Complemento de: **#23 `frida-hypa`** (ADR-0034, baseline nativa).
- Sinergia: **#18** (token accounting), **`frida-context`**, **`frida-mcp-adapter`**.
