# How-to: la pila de aprendizaje de Frida (codebase-index + hermes-memory + knowledge-base)

> Los tres módulos del bloque **Moat** del roadmap: el agente que **aprende el código**
> (`frida-codebase-index`, #25), que **aprende de ti y de tus correcciones**
> (`frida-hermes-memory`, #21) y que **aprende el dominio del proyecto**
> (`frida-knowledge-base`, #29). Este manual explica qué puedes hacer con cada uno y
> te lleva de la mano por un caso de uso práctico que hace visible su valor.

| Módulo | Qué aprende el agente | Dónde vive | Doc de referencia |
| --- | --- | --- | --- |
| `frida-codebase-index` (#25) | **El código**: semántica, símbolos, grafo de llamadas | Índice local del proyecto + `~/.frida/npm` | ADR-0036 |
| `frida-hermes-memory` (#21) | **Tú y el proyecto**: preferencias, correcciones, fallos | `~/.frida/` (MEMORY.md, USER.md, hermes.db) | [docs/tools/frida-hermes-memory.md](tools/frida-hermes-memory.md) |
| `frida-knowledge-base` (#29) | **El dominio**: requerimientos, análisis, decisiones | `<proyecto>/.llm-wiki/` (vault OKF v0.2) | [docs/tools/frida-knowledge-base.md](tools/frida-knowledge-base.md) |

## Prerrequisitos comunes (5 min)

1. **Frida (VSIX) instalado** en VS Code. Al instalarlo se arrastran Foam y el render
   de mermaid como dependencias (`foam.foam`, `bierner.markdown-mermaid`).
2. **Node.js 20+ con npm** en el PATH (los tres paquetes upstream se instalan
   on-demand; nadie descarga nada de antemano).
3. **Primera sesión**: los tres wrappers detectan el paquete ausente y **lo instalan
   en background** sin bloquear el chat. Cuando termine verás la notificación —
   ejecuta `/reload` (o reinicia la sesión) para activar las tools. Instalación
   manual equivalente, si la prefieres:

   ```bash
   npm install open-codebase-index --prefix ~/.frida/npm --legacy-peer-deps
   npm install pi-hermes-memory@0.9.5 --prefix ~/.frida/npm --legacy-peer-deps
   npm install @zosmaai/pi-llm-wiki@0.11.4 --prefix ~/.frida/npm --legacy-peer-deps
   ```

4. **Gates** (todos default `true`): `frida.codebaseIndex.enabled`,
   `frida.hermesMemory.enabled`, `frida.knowledgeBase.enabled`.

Los tres son **main only**: las sesiones hijas de workflows no indexan, no aprenden
ni montan el vault — solo la sesión principal de chat.

---

## 1. `frida-codebase-index` (#25) — el agente que conoce tu código

### Qué puedes hacer (paso a paso)

1. **Indexar el proyecto**: abre la paleta de comandos → `Frida: Codebase Index`
   (o pide en el chat "indexa el proyecto"). La primera vez descarga e indexa;
   después es incremental. También puedes ver el estado en el **tab Index** del
   panel de configuración de Frida (acciones install / index / rebuild / status).
2. **Preguntar por significado, no por texto**: en el chat, preguntas
   *"¿dónde se valida la sesión de usuario?"* → el agente usa `semantic_context`
   y responde citando archivos y líneas reales, con un paquete de evidencia
   acotado (bajo en tokens).
3. **Ver código fuente completo con filtros**: `semantic_search` devuelve el código
   íntegro de los matches (filtra por archivo/directorio si hace falta).
4. **Trazar impacto**: *"¿quiénes llaman a `validateToken`?"* → `call_graph`
   (callers/callees directos). *"¿qué ruta hay de `handleRequest` a
   `executarPago`?"* → `call_graph` con `mode: "path"` (ruta más corta).
5. **Encontrar la definición autoritativa**: *"¿dónde está la implementación real
   de `PaymentGateway`?"* → `implementation_lookup` (prefiere implementación
   sobre tests/docs/fixtures — adiós a editar el mock por error).
6. **Diagnosticar**: *"estado del índice"* → `index_status` (readiness, chunks,
   proveedor de embeddings). Sin proveedor de embeddings configurado funciona en
   modo léxico; la tool misma te guía para habilitar semántica (Ollama local u
   endpoint OpenAI-compatible).

### Caso de uso práctico: "Onboarding exprés a un código heredado"

**Situación**: llegas (o vuelve alguien) a un proyecto de 100k+ líneas que nadie
documentó. Tienes que agregar un descuento por volumen y no sabes por dónde empezar.

**Paso a paso**:

1. Abres la carpeta en VS Code → primera conversación: *"indexa el código"* →
   el agente ejecuta `index_codebase` y reporta chunks indexados.
2. Preguntas: *"¿dónde se calcula el precio total de una orden?"* → el agente
   responde con `semantic_context`: 3–5 archivos citados con las líneas exactas
   del cálculo — no un "creo que es en algo como order.ts".
3. *"¿qué funciones llaman a `calcularTotal`?"* → `call_graph` devuelve los
   callers: el flujo del checkout, los reportes mensuales y un job nocturno que
   no sabías que existía. **Acabas de descubrir el blast radius de tu cambio.**
4. *"muéstrame la implementación de `PriceCalculator`"* →
   `implementation_lookup` te lleva al archivo fuente real (no al fixture del
   test que aparecía primero en una búsqueda de texto).
5. Cierras la conversación con un plan fundamentado en líneas reales.

**Por qué esto ayuda a entender la funcionalidad**: contrasta las dos experiencias.
Sin índice, el agente responde por memoria del modelo ("típicamente los proyectos
hacen X"). Con índice, cita tu código con número de línea y te dice qué llama a qué.
La diferencia se *siente* en la primera respuesta citada — y el call graph convierte
"un cambio simple" en "ojo, hay 3 sistemas colgando de aquí".

---

## 2. `frida-hermes-memory` (#21) — el agente que aprende de ti

### Qué puedes hacer (paso a paso)

1. **Nada, al principio**: la memoria trabaja sola. Cada ~10 turnos / 15 tool
   calls el agente revisa la conversación en background y guarda lo notable.
   Cuando **corriges** algo ("no, en este proyecto usamos tabs"), se guarda al
   instante (correction detection).
2. **Preguntarle qué recuerda**: escribe `/memory-insights` en el chat → lista lo
   guardado en `~/.frida/MEMORY.md` (facts del proyecto) y `USER.md` (tu perfil).
3. **Onboarding deliberado**: `/memory-interview` → el agente te entrevista
   sobre tus preferencias y las persiste.
4. **Buscar en la memoria**: *"usa memory_search para ver si ya probamos
   migrar a Postgres"* → FTS5 sobre todo lo aprendido, incluida la **memoria de
   fallos** (qué no funcionó y por qué, con envejecimiento: 7 días / 5 entradas).
5. **Recuperar sesiones pasadas**: `session_search` busca en el historial completo
   de sesiones ("¿en qué sesión arreglamos el bug del reloj?").
   `/memory-index-sessions` hace backfill de sesiones previas a la instalación.
6. **Skills procedurales**: cuando algo se repite, el agente destila un
   `SKILL.md` reutilizable (`/memory-skills` lista los que ha generado).
7. **Consolidar**: `/memory-consolidate` fusiona/deduplica la memoria acumulada.

**Nota de costo**: el background learning hace llamadas LLM de revisión — consume
tokens. Si prefieres memoria puramente manual (las tools `memory`/`memory_search`
siguen disponibles), apaga `frida.hermesMemory.enabled`.

### Caso de uso práctico: "deja de repetirme las cosas"

**Situación**: cada sesión nueva te toca explicar lo mismo — "responde en español",
"corre `npm run test:unit`, no `npm test`", "no toques generated/", y el agente
vuelve a cometer el error del proxy corporativo que ya te costó una tarde.

**Paso a paso**:

1. **Sesión 1 (lunes)**: corriges al agente 3 veces (idioma, comando de tests,
   directorio prohibido). Al final escribes `/memory-insights` → las tres
   correcciones ya están persistidas. De paso, la tarde del proxy que falló
   quedó registrada como *failure memory*.
2. Cierras VS Code. La conversación murió; la memoria no (`~/.frida/`).
3. **Sesión 2 (martes, proyecto distinto o el mismo)**: pides "corrige los
   tests del módulo de pagos". El agente responde en español, corre
   `npm run test:unit` a la primera y no propone tocar `generated/`.
   **No se lo pediste: lo recordó.**
4. Preguntas: *"¿qué recuerdas de mí y de este proyecto?"* → el agente resume
   tu perfil y los facts del proyecto, y cuando menciona la red/proxy te
   adelanta lo que ya se probó y falló.
5. Semanas después: *"usa memory_search: ¿ya intentamos subir la versión de
   Node?"* → la respuesta sale del historial destilado, no de la nada.

**Por qué esto ayuda a entender la funcionalidad**: la memoria es invisible hasta
que la comparas entre dos sesiones. Este caso la hace visible con la prueba más
simple posible: corrige hoy, no corrijas mañana. El momento "aaaaah" es cuando el
agente aplica la preferencia *sin que la menciones* — y `/memory-insights` te deja
auditar exactamente qué aprendió (nada mágico ni oculto: es un archivo markdown
que puedes leer y editar).

---

## 3. `frida-knowledge-base` (#29) — el agente que domina el dominio

### Qué puedes hacer (paso a paso)

1. **Crear el vault del proyecto**: escribe `/wiki-init <tema>` en el chat →
   crea `<proyecto>/.llm-wiki/` con la estructura OKF v0.2 (wiki/, raw/, meta/).
2. **Ingerir fuentes**: `/wiki-ingest <archivo.md|pdf|URL|texto>` → el agente
   destila la fuente en páginas interlinked (`concepts/`, `entities/`,
   `syntheses/`, `analyses/`) con **provenance**: el raw inmutable queda en
   `raw/` y cada página cita de dónde salió.
3. **Consultar**: `/wiki-query <pregunta>` o directamente que el agente use
   `kb_search` (búsqueda híbrida: léxica siempre, semántica si configuraste
   embeddings). Además, en cada turno el hook de recall inyecta contexto
   relevante del vault automáticamente.
4. **Explorar dependencias**: `kb_neighbors <página>` → out-edges e in-edges con
   el tipo OKF del destino ("¿de qué conceptos depende el análisis de costos, y
   qué sintetiza a partir de ellos?").
5. **Ver el grafo (tú, humano)**: abre el vault en el explorer → **Foam**
   muestra el grafo force-directed, panel de backlinks, huérfanos, plantillas.
   Renombrar una página actualiza sus wikilinks. Los diagramas mermaid se ven
   en el preview nativo.
6. **Mantener la KB sana**: `/wiki-lint` valida el vault, `wiki_status` reporta
   estado, los guardrails bloquean ediciones manuales a `raw/**` y `meta/**`
   (todo pasa por el pipeline con provenance).
7. **Compartir con otros clientes**: el paquete shipea un servidor MCP — agrega a
   la config MCP de Claude Code (u otro cliente):

   ```json
   {
     "mcpServers": {
       "llm-wiki": {
         "command": "node",
         "args": ["<home>/.frida/npm/node_modules/@zosmaai/pi-llm-wiki/dist/mcp/index.js"]
       }
     }
   }
   ```

### Caso de uso práctico: "de requerimientos dispersos a una KB consultable"

**Situación**: el análisis del sistema vive en 3 Word, 2 Excel de trazabilidad, un
PPT de arquitectura y notas sueltas. Nadie encuentra nada y el agente no puede
usarlos para generar código.

**Paso a paso**:

1. Exportas/conviertes los documentos a markdown (la ingesta también acepta PDF y
   URLs; para Office pesado está pendiente `frida-doc-converter`, #30).
2. `/wiki-init Sistema de Pagos` → vault listo.
3. `/wiki-ingest docs/requerimientos-fase1.md` → aparecen páginas
   `concepts/pago-recurrente`, `entities/cliente`, `syntheses/flujo-checkout`,
   cada una con sus wikilinks y la cita a la fuente exacta.
4. `/wiki-ingest docs/notas-reunion-2026-08-10.md` → el agente cruza lo nuevo con
   lo existente: la página de pago recurrente **crece** y enlaza al nuevo
   requerimiento. La KB compone — cada ingesta vale más que la anterior.
5. Preguntas en el chat: *"¿qué requiere el módulo de pagos recurrentes?"* → el
   agente responde con `kb_search` citando páginas del vault (no los Word
   perdidos). *"¿qué depende de `concepts/tokenizacion`?"* → `kb_neighbors`.
6. Abres el grafo de Foam: **ves** el mapa del dominio — el cluster de checkout,
   el análisis de costos conectado a tokenización, y una página huérfana que
   nadie enlazó (sospechosa de requerimiento perdido).
7. La semana siguiente, un compañero pregunta lo mismo desde **Claude Code** vía
   el MCP server: la KB sirve a quien sea, no solo a tu Frida.

**Por qué esto ayuda a entender la funcionalidad**: muestra las dos caras del
mismo vault. El agente consulta (`kb_search`/`kb_neighbors` con provenance) y tú
**ves** (grafo Foam, backlinks, huérfanos). El detalle pedagógico clave es la
segunda ingesta: cuando las páginas nuevas se enlazan solas a las viejas, entiendes
qué significa "auto-mantenida" (patrón Karpathy) — y el huérfano en el grafo es la
prueba visual de que la trazabilidad que vivía en el Excel ahora es estructura.

---

## Los tres juntos: el día a día compuesto

Los tres módulos se refuerzan — cada uno fundamenta una dimensión distinta:

| Pregunta del agente | Quién responde |
| --- | --- |
| "¿Cómo es el código?" | `frida-codebase-index` (`semantic_context`, `call_graph`) |
| "¿Qué exige el negocio?" | `frida-knowledge-base` (`kb_search`, `/wiki-query`) |
| "¿Cómo trabaja este usuario/equipo?" | `frida-hermes-memory` (preferencias, fallos previos) |

**Ejemplo compuesto — "agregar descuento por volumen"**:

1. *"¿qué requiere el negocio de los descuentos?"* → `kb_search` cita la página
   del requerimiento (KB).
2. *"¿dónde vive el cálculo de precio y quién lo llama?"* → `semantic_context` +
   `call_graph` (índice).
3. El agente propone el plan y **ya sabe** que quieres tests con `npm run
   test:unit` y respuestas en español — no se lo repetiste (memoria).
4. Tras implementar, `/wiki-record` documenta la decisión en la KB y el learning
   loop de memoria registra lo aprendido de la sesión. El conocimiento compone
   en las tres capas.

## Troubleshooting rápido

| Síntoma | Causa típica | Solución |
| --- | --- | --- |
| Nota "instalando…" y nada más | Instalación background aún corre / falló red | Espera 1–3 min; si hay warning, corre el `npm install` manual (arriba) |
| Tools responden con guía | Paquete no instalado al arrancar | Instala manual + `/reload` |
| `semantic_*` falla con guía de embeddings | Sin proveedor de embeddings | Sigue la guía de la tool (Ollama local o endpoint compatible) o usa modo léxico |
| Memoria "no recuerda" nada | Sesión hija de workflow (main only) o learning apagado | Usa la sesión principal; revisa `frida.hermesMemory.enabled` |
| `/wiki-*` no aparece | Prompts materializados tras install | `/reload` después de la notificación de instalación |
| Grafo Foam vacío | Vault sin páginas / carpeta equivocada | `/wiki-status` para verificar; abre `<proyecto>/.llm-wiki/wiki` en Foam |

## Referencias

- Issues: [#25](https://github.com/efuentesp/frida-code-vsix/issues/25) ·
  [#21](https://github.com/efuentesp/frida-code-vsix/issues/21) ·
  [#29](https://github.com/efuentesp/frida-code-vsix/issues/29)
- ADRs: 0036 (codebase-index) · 0032 (hermes-memory) · 0040 (knowledge-base)
- Docs por tool: [frida-hermes-memory](tools/frida-hermes-memory.md) ·
  [frida-knowledge-base](tools/frida-knowledge-base.md)
- Roadmap: [docs/roadmap-extensiones.md](roadmap-extensiones.md) (bloque Moat)
