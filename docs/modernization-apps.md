# Investigación: entender, mantener y modernizar aplicaciones desconocidas

> **Objetivo:** definir un kit de herramientas para tomar una aplicación ya
> hecha que no conocemos, entenderla rápidamente, darle mantenimiento y
> eventualmente modernizarla. Punto de partida: SonarQube como referencia de
> "aplicación que da mucha información" sobre un código base.
>
> **Fecha de investigación:** 2026-08-24
> **Método:** búsqueda en el registry de npm (mismo índice que
> pi.dev/packages) vía API + búsqueda en GitHub API + lectura de READMEs de
> los proyectos. Datos de descargas = último mes; estrellas = al momento de
> la consulta.

---

## Tabla de contenido

1. [Marco conceptual: qué significa "entender una aplicación"](#1-marco-conceptual)
2. [Extensiones de Pi para inteligencia de código](#2-extensiones-de-pi)
3. [Proyectos open source de GitHub](#3-proyectos-open-source-de-github)
4. [Comparativa con SonarQube](#4-comparativa-con-sonarqube)
5. [Pipeline recomendado: app desconocida → modernizada](#5-pipeline-recomendado)
6. [Advertencias y riesgos](#6-advertencias-y-riesgos)
7. [Recomendación mínima para empezar](#7-recomendación-mínima-para-empezar)
8. [Próximos pasos sugeridos](#8-próximos-pasos-sugeridos)
9. [Qué construir en Frida para simplificar esto](#9-qué-construir-en-frida-para-simplificar-esto)
10. [Ingeniería inversa funcional: entender la app a nivel de usuario](#10-ingeniería-inversa-funcional-entender-la-app-a-nivel-de-usuario)

---

## 1. Marco conceptual

"Entender una aplicación" involucra cuatro necesidades distintas que ninguna
herramienta cubre sola:

| Necesidad | Pregunta típica | Tipo de herramienta |
| --- | --- | --- |
| **Estructura** | ¿Cómo se organiza el código? ¿Dónde están los módulos, entradas y flujos? | Grafos de código, AST, mapas de dependencias |
| **Calidad** | ¿Qué está mal? ¿Bugs, vulnerabilidades, smells, deuda técnica? | SonarQube, linters, SAST |
| **Impacto** | Si cambio X, ¿qué se rompe? | Análisis de blast radius, referencias, call graphs |
| **Contexto para IA** | ¿Cómo le doy al agente solo lo relevante sin quemar tokens? | Índices semánticos, grafos persistidos, MCP |

SonarQube responde muy bien la segunda, pero no las demás. La investigación
se centró en cubrir las cuatro con herramientas open source integrables al
flujo de trabajo con Pi (coding agent).

---

## 2. Extensiones de Pi

### 2.1 Resumen ejecutivo

| Extensión | Versión | Descargas/mes | Aporte principal | Veredicto |
| --- | ---: | ---: | --- | --- |
| [`pi-lens`](https://www.npmjs.com/package/pi-lens) | 4.1.1 | 52,840 | LSP, diagnósticos, linters, análisis estructural, grafo de dependencias, búsqueda de símbolos, hotspots, mapa visual del proyecto | ✅ **Primera opción** |
| [`pi-shazam`](https://www.npmjs.com/package/pi-shazam) | 0.31.0 | 2,121 | Orientación del repositorio, búsqueda conceptual, referencias, llamadas, blast radius, verificación post-edición | ✅ **Muy recomendable** |
| [`@mrclrchtr/supi-code-intelligence`](https://www.npmjs.com/package/@mrclrchtr/supi-code-intelligence) | 5.0.0 | 4,288 | LSP + Tree-sitter: definiciones, referencias, implementaciones, AST, llamadas, refactorizaciones seguras | 👍 Probar |
| [`open-codebase-index`](https://www.npmjs.com/package/open-codebase-index) | 0.25.1 | 13,086 | Índice semántico local con embeddings, búsqueda híbrida (BM25 + vectores), símbolos y call graph | 👍 Probar en apps grandes |
| [`@narumitw/pi-lsp`](https://www.npmjs.com/package/@narumitw/pi-lsp) | 0.49.5 | 15,810 | Diagnósticos y acciones de código mediante LSP configurable por JSON | 👀 Complementaria |
| [`pi-sonar`](https://www.npmjs.com/package/pi-sonar) | 0.1.0 | 25 | Integración SonarQube: listar issues, verificar archivo, escanear secretos, `/sonar` | 👀 Especializada, madurar |
| [`pi-subagents`](https://www.npmjs.com/package/pi-subagents) | 0.56.0 | 307,741 | Delegar exploración a agentes especializados (scout, oracle, reviewer) con varias perspectivas | ✅ Complemento útil |

Todas son MIT salvo indicación contraria.

### 2.2 `pi-lens` — salud técnica en tiempo real

La más instalada del ecosistema (52,840 descargas/mes) y la más completa
como "panel de salud" dentro de Pi:

- Diagnósticos LSP en cada edición (impact cascade: archivos relacionados).
- Linters, type-checkers, formatters y escáneres de seguridad por lenguaje.
- Reglas estructurales tree-sitter + ast-grep (smells de corrección/seguridad).
- Grafo de revisión del proyecto: hubs (fan-in), entry points, hotspots de
  complejidad, peso muerto (archivos sin importadores).
- Búsqueda de símbolos rankeada (`symbol_search` → `module_report` →
  `read_symbol`).
- `/lens-map`: mapa HTML interactivo de dependencias del proyecto.
- Guardas de lectura antes de editar y de git (retiene commit/push con
  hallazgos sin resolver).
- Escaneos de fondo: knip (código muerto), jscpd (copy-paste), madge (deps
  circulares), gitleaks (secretos), trivy/govulncheck (CVEs).

**Equivalencia conceptual:** como combinar Sonar (calidad) + IDE
(navegación/diagnósticos) + análisis estructural, pero en vivo durante la
sesión del agente.

### 2.3 `pi-shazam` — orientación y blast radius

Diseñada específicamente para que el agente **entienda** código:

| Herramienta | Función |
| --- | --- |
| `shazam_overview` | Resumen del proyecto: archivos clave, dependencias, hotspots, entry points |
| `shazam_lookup` | Búsqueda unificada de símbolos y búsqueda conceptual difusa ("cómo se implementa X") |
| `shazam_impact` | Blast radius: archivos, símbolos y tests afectados por un cambio |
| `shazam_verify` | Verificación post-edición: LSP + grafo, PASS/WARN/FAIL |
| `shazam_changes` | Resumen de cambios git con detalle a nivel símbolo |
| `shazam_format` | Auto-fix de formato (prettier, biome, eslint, ruff, cargo fmt, gofmt) |
| `shazam_rename_symbol` | Renombrado semántico cross-file atómico |

Lenguajes con tree-sitter + LSP: Python, TypeScript, JavaScript, Go, Rust,
Dart, JSON, YAML. Binarios precompilados para las 6 plataformas comunes.

**Nota de instalación:** en la prueba temporal (`pi -e npm:pi-shazam`) una
dependencia nativa (`tree-sitter-javascript` vía node-gyp) tardó más que el
timeout de la prueba. No es bloqueante: conviene instalarlo con tiempo y
verificar con `/shazam-doctor`.

### 2.4 `@mrclrchtr/supi-code-intelligence` — navegación semántica explícita

Ocho herramientas `code_*` respaldadas por LSP + Tree-sitter, con enfoque de
"engine de inteligencia": `code_orientation`, `code_resolve`, `code_inspect`,
`code_graph`, `code_find`, `code_health`, más refactorización con vista
previa (rechaza planes si los archivos cambiaron). Al reconocer un workspace
inyecta un overview de arquitectura al inicio de sesión.

### 2.5 `open-codebase-index` — búsqueda semántica con embeddings

Índice local (SQLite + usearch + BM25) con parsing nativo para 20+
lenguajes. Fortaleza: responder preguntas donde **no se conoce el
identificador** ("¿dónde se valida el estado de autenticación antes de una
petición?"). Requiere construir/mantener índice y opcionalmente configurar
proveedor de embeddings (Ollama local, OpenAI, Google o endpoint compatible).

Herramientas destacadas: `codebase_context` (paquete de evidencia acotado),
`codebase_peek` (ubicaciones sin cuerpos), `implementation_lookup`,
`call_graph`, `call_graph_path`, `find_similar` (duplicados/análogos).

### 2.6 `@narumitw/pi-lsp` — LSP configurable

Enfoque minimalista y honesto (su README cita la crítica de Eric Traut sobre
LSP en agentes): servidores configurados por JSON, arranque por llamada,
diagnósticos estructurados y acciones `source.fixAll` / `source.organizeImports`.
Útil cuando los comandos nativos del repo son lentos y se quiere feedback
intermedio acotado. No ofrece navegación/rename.

### 2.7 `pi-sonar` — integración SonarQube directa

Herramientas `sonar_list_issues` (filtro por severidad/rama/PR),
`sonar_verify_file` (verificar archivo tras editarlo) y
`sonar_analyze_secrets`; skill `sonar-cli` y comando `/sonar`. Auto-detecta
config desde `sonar-project.properties` / `.sonarcloud.properties`.

**Cautela:** v0.1.0, ~25 descargas/mes, README con placeholder de repo en
las instrucciones de instalación. Si ya tienen SonarQube, empezar usando el
CLI/API de Sonar desde Pi y reevaluar la extensión cuando madure.

### 2.8 `pi-subagents` — perspectivas múltiples

El estándar de facto de delegación (307,741 descargas/mes). Para este caso
de uso, el agente builtin **`scout`** ("fast local codebase recon: relevant
files, entry points, data flow, risks") es el más relevante, combinable con
`oracle` (segunda opinión) y `reviewer` (revisión).

### 2.9 Resultado de las pruebas de carga temporal (`pi -e`)

| Extensión | Resultado |
| --- | --- |
| `pi-lens` | Dependencias instaladas OK; sesión interactiva excedió el timeout de la prueba (esperado en modo interactivo) |
| `pi-shazam` | Compilación nativa tree-sitter lenta → timeout de la prueba; no indica incompatibilidad |
| `supi-code-intelligence` | Timeout de la sesión interactiva de prueba |

Conclusión: ninguna descartada; validar en sesión normal de Pi.

---

## 3. Proyectos open source de GitHub

### 3.1 Resumen ejecutivo

| Proyecto | ⭐ | Licencia | Qué aporta | Integración con Pi |
| --- | ---: | --- | --- | --- |
| [DeusData/codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) | 40,333 | MIT | Grafo de conocimiento persistente en C puro: 158 lenguajes, call chains, rutas HTTP, dead code, IaC indexado, UI 3D; kernel Linux en 3 min | ✅ **Nativa** (su instalador detecta Pi y escribe `~/.pi/agent/AGENTS.md` + skill) |
| [tirth8205/code-review-graph](https://github.com/tirth8205/code-review-graph) | 30,777 | MIT | Grafo estructural local-first Tree-sitter, incremental, MCP + CLI; 71× menos tokens explorando Flask | Via `pi-mcp-adapter` (no auto-detecta Pi) |
| [likec4/likec4](https://github.com/likec4/likec4) | 5,475 | MIT | Diagramas C4 vivos "as code", actualizados desde el código | Complemento humano/visual |
| [openrewrite/rewrite](https://github.com/openrewrite/rewrite) | 3,668 | Apache-2.0 | Refactoring masivo determinista; ~59 repos de recetas: Java 8→21, javax→jakarta, Spring Boot 2→3, seguridad | CLI; MCP para agentes vía Moderne (comercial) |
| [giancarloerra/SocratiCode](https://github.com/giancarloerra/SocratiCode) | 3,274 | ⚠️ **AGPL-3.0** | Búsqueda híbrida semántica+BM25 (RRF), grafos poliglotas, impacto por símbolo, explorador HTML; probado en 40M+ LOC | Via MCP; requiere Docker (Qdrant) |
| [cased/kit](https://github.com/cased/kit) | 1,310 | MIT | Toolkit para construir context engineering: mapeo de código, extracción de símbolos, varios tipos de búsqueda | Librería/CLI |
| [probelabs/probe](https://github.com/probelabs/probe) | 692 | Apache-2.0 | Búsqueda semántica que combina velocidad de ripgrep con AST Tree-sitter | Via MCP |
| [MaibornWolff/codecharta](https://github.com/MaibornWolff/codecharta) | 496 | BSD-3 | Mapas 3D interactivos de métricas; **importa métricas de Sonar directamente** (`ccsh sonarimport`) | Complemento visual |
| [konveyor/move2kube](https://github.com/konveyor/move2kube) | 412 | Apache-2.0 | Analiza artefactos legacy y genera IaC para replatforming a Kubernetes/OpenShift | CLI |
| [Azure-Samples/Legacy-Modernization-Agents](https://github.com/Azure-Samples/Legacy-Modernization-Agents) | 210 | MIT | Referencia: agentes COBOL→Java/Quarkus con análisis, conversión y mapeo de dependencias | Inspiración/arquitectura |

Hallazgos también-ran (watchlist): `aeroxy/ast-bro` (⭐223, navegación AST
token-budgeted), `husnainpk/SymDex` (⭐209, oráculo local 16 lenguajes),
`jamubc/gemini-mcp-tool` (⭐2,276, delegar análisis masivo a ventana grande
de Gemini), `elara-labs/code-context-engine` (⭐401, MCP local gratuito),
`pahen/madge` (⭐10,161, grafos de dependencias JS) y `thebjorn/pydeps`
(⭐2,106, Python).

### 3.2 `codebase-memory-mcp` — el más adoptado

Motor en C puro, single binary, cero dependencias de runtime. Índice
persistente en grafo con funciones, clases, cadenas de llamadas, rutas HTTP
y enlaces cross-service. Híbrido LSP (resolución de tipos) para 11
lenguajes. 15 herramientas MCP incluyendo consultas Cypher, detección de
código muerto y gestión de ADRs. Indexa incluso Dockerfiles/K8s manifests
como nodos del grafo. UI 3D en `localhost:9749`. Preprint en arXiv
(2603.27277) con evaluación en 31 repos: 83% de calidad de respuesta, 10×
menos tokens, 2.1× menos llamadas a herramientas vs exploración
archivo-por-archivo.

**Verificado:** su tabla de plataformas soportadas incluye Pi como cliente
detectado (`~/.pi/agent/AGENTS.md` + skill; MCP/subagents requieren
extensión revisada explícita).

### 3.3 `code-review-graph` — grafo para revisión y repos grandes

Python (pip/pipx), MCP + CLI, incremental con file watching. `install`
auto-detecta 14+ plataformas (Codex, Claude Code, Cursor, Windsurf, Zed,
Gemini CLI, Copilot…) pero **no Pi** → configurar manualmente con
`pi-mcp-adapter`. Benchmark propio: responder una pregunta sobre Flask cuesta
2,196 tokens vía grafo vs 143,594 leyendo archivos (71×).

### 3.4 `SocratiCode` — potencia con letra pequeña

Muy completo (búsqueda híbrida RRF, multi-repo/multi-rama/multi-agente,
artefactos de BD/API/infra indexados y buscables, impacto simbólico en 18
lenguajes, benchmark en VS Code 2.45M LOC) pero: licencia **AGPL-3.0**
(revisar si se redistribuye o modifica) y requiere **Docker corriendo**
(Qdrant auto-gestionado). Cloud en beta privada.

### 3.5 `OpenRewrite` — modernización determinista

Ecosistema de recetas de refactoring masivo sobre Lossless Semantic Trees
(type-aware, no regex). Para la fase de modernización es el caballo de
batalla de Java/Kotlin/Groovy (recetas open source completas) y con cubrimiento
creciente en JS/TS, Python y C# (estas últimas con recetas base abiertas;
ejecución masiva multi-repo vía Moderne, comercial). Regla de oro para
legacy: **las migraciones mecánicas van con recetas deterministas; el agente
se queda con lo que requiere criterio.**

### 3.6 `LikeC4` y `CodeCharta` — puentes humanos

- **LikeC4**: modelas la arquitectura como código (DSL inspirado en C4) y
  los diagramas se mantienen vivos. Ideal para documentar la arquitectura
  *descubierta* en la fase de entendimiento y para comunicarla al equipo.
- **CodeCharta**: convierte métricas (incluidas las de Sonar) en mapas 3D
  navegables (ciudad de código). `ccsh sonarimport` + Web Studio, todo
  local, sin telemetría. Excelente para presentar hotspots a stakeholders.

---

## 4. Comparativa con SonarQube

| Necesidad | Mejor herramienta |
| --- | --- |
| Bugs potenciales y code smells | SonarQube |
| Vulnerabilidades | SonarQube (complementar con SAST específico) |
| Cobertura y quality gate | SonarQube |
| Dónde está implementada una funcionalidad | `pi-shazam` / `supi-code-intelligence` / `codebase-memory-mcp` |
| Callers y callees de un símbolo | `pi-shazam` / `supi-code-intelligence` |
| Impacto de modificar un módulo | `pi-shazam` (blast radius) / `pi-lens` / `SocratiCode` |
| Diagnósticos mientras Pi edita | `pi-lens` |
| Mapa de dependencias del proyecto | `pi-lens` (`/lens-map`) / madge / pydeps |
| Preguntas conceptuales sin conocer identificadores | `open-codebase-index` (embeddings) / `SocratiCode` |
| Visualizar métricas de Sonar | CodeCharta (`ccsh sonarimport`) |
| Migraciones mecánicas masivas | OpenRewrite |
| Exploración multi-perspectiva | `pi-subagents` (scout/oracle/reviewer) |

**Conclusión:** Sonar no es sustituido sino complementado. Sonar = qué está
mal; grafo/LSP/índice = cómo está construido; OpenRewrite = cómo se
moderniza en masa.

---

## 5. Pipeline recomendado

### FASE 0 — Foto rápido (día 1)

```text
├─ codebase-memory-mcp   → grafo completo: módulos, entradas, rutas HTTP, dead code
├─ pi-shazam             → shazam_overview: hotspots, entry points, dependencias
└─ pi-lens               → /lens-map: mapa HTML de dependencias + salud técnica
```

### FASE 1 — Diagnóstico (semana 1)

```text
├─ SonarQube             → bugs, vulnerabilidades, smells, cobertura, quality gate
├─ CodeCharta            → visualizar métricas de Sonar como mapa 3D
├─ madge / pydeps        → dependencias circulares por lenguaje
└─ pi-subagents (scout)  → reporte de riesgos con varias perspectivas
```

### FASE 2 — Documentar arquitectura (semanas 2-3)

```text
├─ LikeC4                → diagramas C4 vivos "as code" para el equipo
└─ annotate-guidance     → .rpiv/guidance/ para orientar a futuros agentes y humanos
```

### FASE 3 — Mantenimiento (continuo)

```text
├─ pi-lens + pi-shazam   → diagnósticos en cada edición + blast radius antes de tocar
└─ Sonar + Pi            → cada fix verificado contra el quality gate
```

### FASE 4 — Modernización (cuando toque)

```text
├─ OpenRewrite           → recetas deterministas: Java 8→21, Spring Boot 2→3, javax→jakarta
├─ move2kube             → generar IaC de K8s para lo que ya quedó limpio
└─ Pi + pipeline rpiv    → discover → research → design → plan → implement
                           para lo que requiere criterio (no automatizable)
```

### Por qué funciona esta combinación

1. **Separación de responsabilidades:** Sonar dice *qué* está mal; el grafo
   dice *cómo* está construido; juntos = diagnóstico completo.
2. **Determinista primero en modernización:** OpenRewrite usa AST type-aware;
   un `javax→jakarta` con sed/regex rompe todo. El agente se queda con lo
   que exige juicio.
3. **El problema real es el contexto, no el modelo:** los tres proyectos top
   atacan lo mismo — el agente quemando tokens releyendo archivos. Los
   benchmarks reportan 10-120× menos tokens vía grafo que archivo por
   archivo. En apps desconocidas grandes, eso decide viabilidad y costo.

---

## 6. Advertencias y riesgos

- **SocratiCode es AGPL-3.0**: si se redistribuye o modifica (no solo uso
  interno), revisar implicaciones legales. Requiere Docker corriendo.
- **Benchmarks auto-reportados:** los números ("37× faster", "99% fewer
  tokens", "71×") provienen de los propios proyectos; tomarlos como
  dirección, no como garantía.
- **`code-review-graph` no detecta Pi automáticamente:** configurar a mano
  vía `pi-mcp-adapter`.
- **Moderne (comercial sobre OpenRewrite):** recetas core abiertas; modo
  multi-repo/MCP para agentes requiere licencia.
- **Proyectos jóvenes:** la ola de stars es de 2025-2026; evaluar madurez y
  mantenimiento caso por caso.
- **`pi-sonar` (v0.1.0, 25 descargas/mes, placeholder en README):** no
  instalar en producción todavía; usar CLI/API de Sonar directamente.
- **Embeddings locales vs nube:** `open-codebase-index` y SocratiCode pueden
  mandar código a proveedores de embeddings (OpenAI/Gemini) si se configura;
  para código de clientes, preferir Ollama local o la indexación puramente
  estructural (tree-sitter/LSP) que no sale de la máquina.

---

## 7. Recomendación mínima para empezar

```bash
# 1. Inteligencia de código (nativa en Pi, auto-configurada)
#    Seguir instrucciones de https://github.com/DeusData/codebase-memory-mcp
codebase-memory install   # detecta Pi solo

# 2. Extensiones Pi
pi install npm:pi-lens
pi install npm:pi-shazam
pi install npm:pi-subagents   # si aún no está

# 3. Visualización de métricas de Sonar existentes
ccsh sonarimport              # CodeCharta Shell importa Sonar → mapa 3D
```

Ciclo resultante: **entender** (grafo + overview) → **diagnosticar**
(Sonar + linters) → **visualizar** (CodeCharta/LikeC4) → **mantener**
(lens + shazam en cada cambio) → **modernizar** (OpenRewrite para lo
mecánico, Pi para lo que requiere criterio).

### Preguntas que este kit responde desde el día 1

```text
Mapea esta aplicación y explícame dónde se autentican los usuarios.
¿Qué módulos llaman al servicio de pagos?
¿Dónde se valida el estado de autenticación antes de una petición?
¿Qué impacto tendría cambiar esta interfaz?
¿Cuál es el flujo desde este endpoint hasta la base de datos?
Encuentra implementaciones parecidas a este flujo.
¿Qué código está muerto y nunca se llama?
```

---

## 8. Próximos pasos sugeridos

1. **Piloto medible:** clonar una app legacy open source (p. ej. un Spring
   Boot 2.x o un Express monolito con años de historia), correr el pipeline
   completo y cronometrar cuánto tarda "entenderla" (overview + mapa +
   diagnóstico) con y sin el kit.
2. **Validar `pi-shazam` con calma:** instalación completa (la compilación
   nativa puede tardar) + `/shazam-doctor`.
3. **Evaluar `codebase-memory-mcp` vs `pi-shazam` + `pi-lens`** en el mismo
   repo para decidir si conviene mantener ambos o consolidar.
4. **Definir política de privacidad de embeddings** antes de habilitar
   búsqueda semántica en código de clientes.
5. **Probar una receta OpenRewrite** sobre el piloto (p. ej.
   `org.openrewrite.java.migrate.UpgradeToJava21`) para medir el lado
   "modernizar".
6. **Definir el roadmap de Frida** — ✅ integrado (2026-08-24) en
   [docs/roadmap-extensiones.md](roadmap-extensiones.md), sección **Pista M**
   (M8/M1→P1, M9/M2/M3→P2, M6→P3). ✅ Issues creados: **#133 (M8)**,
   **#134 (M1)**, **#135 (M9)** — los tres primeros de la pista. Quedan por
   levantar los de M2, M3 y M6 cuando se planifique su sprint.
7. **Piloto funcional:** cuando M8 exista, correr `app-walkthrough` sobre
   la app del piloto con una sesión real y contrastar el catálogo funcional
   contra el entendimiento técnico de M1 — ¿qué funcionalidad no tiene
   código localizable? ¿qué módulos nunca se ejercitan?

---

## 9. Qué construir en Frida para simplificar esto

Frida ya resuelve parte del pipeline de la sección 5. Esta sección mapea
las brechas restantes contra las cuatro necesidades del marco conceptual
(§1) y propone qué piezas construir o portar, priorizadas por valor,
esfuerzo y riesgo.

> **2026-08-24 — Integrado al roadmap oficial:** estas piezas viven ahora en
> [docs/roadmap-extensiones.md](roadmap-extensiones.md), sección **Pista M**,
> con IDs **M1–M9** — incluidos **M8 (`app-walkthrough`)** y **M9
> (`frida-traffic2api`)** derivados de la sección 10 (entendimiento
> funcional). El orden autoritativo es el de la Pista M: **M8 → M1 → M9 →
> M2 → M3 → M6** (M7 micro-tarea; M4/M5 condicionales). Al integrar se
> detectó que **#25 `frida-codebase-index` (✅ v0.30.0, wrapper de
> open-codebase-index)** ya cubre búsqueda semántica más call graph y gestión
> de proveedores de embeddings, y que pi-lens ya da hotspots (`project_report`)
> y rename (`lsp_navigation`): por eso M4 (pi-shazam) se re-escaló a
> *evaluar/cancelar* y M5 (codegraph) a *watchlist*.

### 9.1 Qué tiene Frida hoy

| Capacidad | Estado en Frida | Referencia |
| --- | --- | --- |
| Capa semántica del agente (LSP, `symbol_search` → `module_report` → `read_symbol`, ast-grep, blast radius, read-guard) | ✅ Integrada: pi-lens como capa del *agente*, mutaciones desactivadas, diagnósticos como resumen por turno en el panel | D16, ADR-0008, `src/pilens-config.ts` + `src/lens-diagnostics-bridge.ts` |
| Orquestación de fases con skills, jueces y fanout | ✅ `frida-workflow` (porte nativo de rpiv-workflow, motor completo) | D32, ADR-0020 |
| Delegación multi-perspectiva (scout/oracle/reviewer) | ✅ `frida-subagents` | — |
| UI rica para paneles (Remote React) | ✅ `frida-webview` (`fbox`/`ftext`/`fmarkdown`) | D20, ADR-0012 |
| LSP para el humano que edita | ✅ El propio de VS Code (distinto del de pi-lens por diseño) | D16 |
| Integración SonarQube | ❌ No existe | — |
| Overview conceptual del repo (hotspots, búsqueda difusa "cómo se implementa X") | ✅ Cubierto por partes: pi-lens `project_report` (hubs/hotspots) + #25 semántica; falta orquestarlo como flujo guiado | M1 |
| Búsqueda semántica + call graph | ✅ **#25 `frida-codebase-index` completo en v0.30.0** (wrapper de open-codebase-index): autoindex, 4 proveedores de embeddings, ping/candado | — |
| Grafo persistente para monolitos de millones de LOC | ⚠️ Cubierto por #25 hasta cierta escala; sin validar en monolitos enormes | M5 (watchlist) |
| Visualización de mapa/arquitectura en producto | ❌ No existe (el HTML de `/lens-map` queda fuera del producto) | — |
| Runner de recetas de modernización determinista (OpenRewrite) | ❌ No existe | — |

### 9.2 Matriz de brechas → piezas propuestas

| Necesidad (§1) | Herramienta de la investigación | Brecha en Frida | Pieza propuesta |
| --- | --- | --- | --- |
| Estructura | pi-lens, pi-shazam | Casi nula: `project_report` + `symbol_search` + rename (`lsp_navigation`) ya la cubren; falta el flujo guiado | **M1** (orquestar) |
| Calidad (Sonar) | pi-sonar, CLI Sonar | Total | **M3 `frida-sonar`** |
| Impacto | pi-lens blast radius, `shazam_impact` | Cubierto (blast radius + rename vía pi-lens) | — |
| Contexto IA (repos gigantes) | codebase-memory-mcp | Cubierto por #25✅ hasta cierta escala; sin validar en monolitos enormes | M5 (watchlist, condicionado al piloto) |
| Contexto IA (preguntas sin identificador) | open-codebase-index (embeddings) | **Ya cubierto por #25✅**; solo falta registrar el router como proveedor | M7 (micro-tarea) |
| Visualización | `/lens-map`, CodeCharta, LikeC4 | El HTML existe pero no está en producto | **M2 panel "Mapa del proyecto"** |
| Modernización mecánica | OpenRewrite | Total | **M6 `frida-openrewrite`** |
| Orquestación end-to-end | pipeline rpiv | Motor listo, fases sin definir | **M1 workflow `understand-app`** |

### 9.3 Roadmap de construcción

> Fuente de verdad de la priorización:
> [docs/roadmap-extensiones.md](roadmap-extensiones.md) (items M1–M7
> integrados el 2026-08-24; detalle de diseño en las subsecciones siguientes).

| # | Pieza | Tipo | Esfuerzo | Prioridad roadmap | Cubre fase(s) | Valor |
| --- | --- | --- | --- | --- | --- |
| M8 | Workflow `app-walkthrough` | Skills sobre `frida-agent-browser` (D34) | S–M | **P1** | A | El agente usa la app como usuario y documenta la funcionalidad (ver §10) |
| M1 | Workflow `understand-app` | Skills + DSL sobre `frida-workflow` | S–M | **P1** (moat) | 0–2 | Alto: orquesta todo lo demás con cero infra nueva |
| M9 | `frida-traffic2api` | HAR/mitmproxy → OpenAPI + matriz función↔endpoint↔módulo | M | **P2** | B | Puente funcional↔técnico (ver §10) |
| M2 | Panel "Mapa del proyecto" | `frida-webview` + `/lens-map` | S | P4 | 0 | Alto para comunicar la estructura al equipo |
| M3 | `frida-sonar` | Extensión nueva (base de diseño: pi-sonar) | M | **P2** | 1, 3 | Alto si la empresa ya opera SonarQube |
| M4 | Porte parcial de pi-shazam | Porte evaluado contra upstream | M | P4 — **evaluar/cancelar** | 0, 3 | Bajo tras detectar solape (pi-lens + #25) |
| M5 | `frida-codegraph` | Extensión nueva | L | P4 — watchlist | 0 | Alto solo si #25 no escala en monolitos enormes |
| M6 | `frida-openrewrite` | Extensión nueva | M–L | **P3** | 4 | Alto en modernización Java/jakarta |
| M7 | Embeddings vía router | Configuración de #25 | XS | P4 — micro-tarea | 0 | Medio: habilita semántica con el router autorizado |

#### M1 — Workflow `understand-app` (quick win principal)

Cadena las FASES 0–2 del pipeline como skills sobre el motor de
`frida-workflow` (que ya soporta cadenas con jueces, fanout y loops):

```text
overview (pi-lens project_report) ─→ hotspots y riesgos (fanout de scouts)
  ─→ documento de entendimiento (juez verify: "¿responde las 7 preguntas
  del día 1?" §7) ─→ modelo LikeC4 semilla + docs/arquitectura
```

- Entregables: `docs/entendimiento.md`, modelo LikeC4 inicial, mapa de
  riesgos priorizado, checklist de verificación.
- Todo corre sobre infra ya construida y testeada (D32); no hay nuevas
  dependencias.
- Reutiliza el patrón de gates de `ApprovalBridge` para cualquier mutación.

#### M2 — Panel "Mapa del proyecto"

El HTML interactivo de `/lens-map` (pi-lens) ya existe pero hoy queda fuera
 del producto. Opciones en orden de costo:

1. Comando que genere y abra el HTML en un panel de VS Code (S).
2. Panel nativo en `frida-webview` que renderice el grafo con `fbox`/
   `fmarkdown` y permita clic → abrir archivo (S–M).

CodeCharta queda como herramienta externa para presentaciones a
stakeholders; no se construye dentro de Frida.

#### M3 — `frida-sonar`

Integración SonarQube seria, tomando el diseño de pi-sonar (v0.1.0) como
referencia pero reescribiendo (su README tiene placeholders y 25
 descargas/mes):

- Tools: `sonar_list_issues` (severidad/rama/PR), `sonar_verify_file`
  (post-edición), `sonar_quality_gate`.
- Panel en `frida-webview`: estado del quality gate, issues nuevas vs.
  resueltas por turno, tendencia.
- Auth: token desde configuración de la empresa (nunca inline);
  auto-detección de `sonar-project.properties`.
- Regla del repo: antes de portar, comparar contra el fuente original en
  `~/.pi/agent/npm` (instrucción de AGENTS.md para extensiones portadas).

#### M4 — Porte parcial de pi-shazam (re-evaluado: evaluar/cancelar)

Propuesta original: portar overview con ranking de hotspots,
`shazam_lookup` (búsqueda conceptual difusa) y `shazam_rename_symbol`
(rename atómico cross-file). **Re-evaluación 2026-08-24:** pi-lens ya da
hotspots (`project_report`), búsqueda difusa (`symbol_search` + semántica
de #25) y rename (`lsp_navigation`); el solape es casi total. Decisión:
construir solo el gap que el piloto de la sección 8 demuestre; si no hay
gap, cancelar (evita doble LSP/doble tree-sitter, el mismo trade-off que
ya resolvió D16).

#### M5 — `frida-codegraph` (watchlist, condicionado al piloto)

Grafo persistente local inspirado en codebase-memory-mcp para los casos
enterprise donde #25/pi-lens no escalen (monolitos de millones de LOC):
tree-sitter + SQLite, call graph, dead code, rutas HTTP. Sin embeddings
de terceros, sin nube, todo local (política egress). **Construir solo si
el piloto de la sección 8 demuestra que #25 se queda corto** en las apps
objetivo; si el mercado ya entrega un binario local usable, evaluar
integrarlo antes que construir.

#### M6 — `frida-openrewrite`

Runner de recetas deterministas para la FASE 4:

- Siempre dry-run primero: diff presentado en el editor de VS Code.
- El agente revisa el diff, ajusta lo no automatizable, y la verificación
  (build + tests + `frida-sonar` si existe) corre después.
- Enfocado a las recetas abiertas de migración Java (8→21, javax→jakarta,
  Spring Boot 2→3); Moderne (comercial) queda fuera.

#### M7 — Búsqueda semántica vía embeddings del router (micro-tarea)

La única capacidad que ni pi-lens ni un grafo estructural cubren: preguntas
sin conocer el identificador ("¿dónde se valida la sesión antes de una
petición?") — **ya resuelta por #25** (`frida-codebase-index`). Lo único
pendiente: registrar el **router interno** como proveedor de embeddings
(el motor ya soporta 4 proveedores custom OpenAI-compatibles, con ping y
candado). Condición dura: el router debe ofrecer un endpoint de embeddings
compatible OpenAI; si no existe, la semántica queda limitada a Ollama local
(mandar código a OpenAI/Gemini viola la política egress del CONTEXT.md §2).
El índice (BM25 + vectores) vive local.

### 9.4 Reglas del repo que aplican a todas las piezas

- **Portes:** revisar primero el código fuente de la extensión original de
  Pi en `~/.pi/agent/npm/node_modules/` antes de ensayar soluciones
  (instrucción explícita de AGENTS.md).
- **Mutaciones por el gate:** cualquier tool que escriba archivos pasa por
  el gate de aprobación (D7). Precedente: el autofix/format de pi-lens está
  desactivado justamente porque mutaba fuera del gate (`src/pilens-config.ts`).
- **Permisos declarativos:** cada extensión nueva se registra en
  `frida-permission-system` (D28).
- **Todo local:** nada de APIs de terceros que manden código fuera de la
  máquina/router (CONTEXT.md §2). Las herramientas de la investigación que
  requieren embeddings en nube quedan descartadas o condicionadas.
- **Gobernanza:** cada pieza se captura como issue de GitHub (`enhancement`)
  y las decisiones difíciles de revertir (p. ej. construir M5 vs integrar
  un binario externo) como ADR en `docs/adr/`.

### 9.5 Qué NO construir (usar como herramientas externas)

| Herramienta | Por qué no construirla |
| --- | --- |
| CodeCharta | Visualización para humanos; `ccsh sonarimport` + Web Studio ya resuelven sin integración |
| LikeC4 | DSL y preview ya son maduros; Frida solo genera/mantiene los modelos (M1) |
| madge / pydeps | CLIs puntuales; el agente los invoca con `bash` cuando hace falta |
| Moderne | Comercial; las recetas core de OpenRewrite son abiertas |
| pi-sonar tal cual | v0.1.0 con placeholders; solo se toma su diseño de tools como referencia |

---

## 10. Ingeniería inversa funcional: entender la app a nivel de usuario

Las secciones anteriores entienden la app desde el **código**. Esta
responde la pregunta complementaria: ¿cómo entender la **funcionalidad**
que la app le entrega al usuario — pantallas, flujos, validaciones, roles —
sin partir del fuente? Es ingeniería inversa de **comportamiento
observable**: la evidencia es la app ejecutándose, su tráfico y su uso real.

> **2026-08-24 — Integrado al roadmap:** de aquí salen **M8
> (`app-walkthrough`)** y **M9 (`frida-traffic2api`)**, hoy en la cima de la
> [Pista M](roadmap-extensiones.md) (P1 y P2). El motor de exploración ya
> existe: `frida-agent-browser` (D34) — falta la orquestación.

### 10.1 Extensiones de Pi (descargas último mes, 2026-08-24)

| Extensión | /mes | Qué aporta | Veredicto |
| --- | ---: | --- | --- |
| [`agent-browser`](https://www.npmjs.com/package/agent-browser) | 4,944,173 | El agente usa la app como usuario: navegar, llenar formularios, snapshots semánticos (a11y tree = modelo funcional de cada pantalla), screenshots, tráfico de red | ✅ Corazón del enfoque — en Frida es `frida-agent-browser` (D34) |
| [`pi-web-access`](https://www.npmjs.com/package/pi-web-access) | 343,587 | Análisis de video local/YouTube: los tutoriales y demos de la app SON documentación funcional | ✅ Oro escondido (fuente secundaria de M8) |
| [`@amaster.ai/pi-computer-use`](https://www.npmjs.com/package/@amaster.ai/pi-computer-use) | 5,612 | Automatización de escritorio (apps nativas Windows/macOS) | 👍 Para apps desktop legacy |
| [`@amaster.ai/pi-browser-use`](https://www.npmjs.com/package/@amaster.ai/pi-browser-use) | 3,704 | Alternativa vía chrome-devtools-mcp (incluye inspección de red) | 👀 Alternativa a agent-browser |
| [`@narumitw/pi-chrome-devtools`](https://www.npmjs.com/package/@narumitw/pi-chrome-devtools) | ~15,810 | Herramientas CDP: capturar tráfico/performance durante la exploración | 👀 Complemento |
| [`pi-playwright`](https://www.npmjs.com/package/pi-playwright) | 996 | Skill Playwright: convertir journeys descubiertos en tests reproducibles | 👀 Documentar como tests |
| [`pi-sense`](https://www.npmjs.com/package/pi-sense) | 533 | Visión para modelos text-only: describir capturas de la app | 👀 Si el modelo no tiene visión |

### 10.2 Proyectos open source de GitHub

| Proyecto | ⭐ | Licencia | Qué aporta |
| --- | ---: | --- | --- |
| [browser-use/browser-use](https://github.com/browser-use/browser-use) | 110,346 | MIT | El estándar de agentes web: "usa esta app y dime qué puede hacer" |
| [alibaba/page-agent](https://github.com/alibaba/page-agent) | 28,813 | MIT | Agente GUI dentro de la página — exploración natural de interfaces |
| [browserbase/stagehand](https://github.com/browserbase/stagehand) | 24,044 | MIT | SDK de navegador para agentes: `act`/`extract`/`observe` — el `observe` es literalmente descubrir funcionalidad |
| [Skyvern-AI/skyvern](https://github.com/Skyvern-AI/skyvern) | 22,843 | ⚠️ AGPL-3.0 | Workflows de navegador con IA + visión (ojo licencia) |
| [appium/appium](https://github.com/appium/appium) | 21,881 | Apache-2.0 | Automatización móvil (Android/iOS) — mismo enfoque en apps nativas |
| [web-infra-dev/midscene](https://github.com/web-infra-dev/midscene) | 14,663 | MIT | GUI agent para E2E: describe la app en lenguaje natural → flujos como tests ejecutables |
| [hyperdx](https://github.com/hyperdxio/hyperdx) / [highlight.io](https://github.com/highlight/highlight) | 9,860 / 9,368 | MIT / Apache-2.0 | Session replay self-hosted: ver cómo usan la app los usuarios reales |
| [pm4py](https://github.com/process-intelligence-solutions/pm4py) | 1,013 | AGPL-alterna | Process mining: reconstruye los flujos de usuario REALES (no los ideales) desde logs de eventos |
| [retentioneering](https://github.com/retentioneering/retentioneering-tools) | 914 | MIT | Clickstream/journeys con server MCP y agent skills |
| [honeynet/droidbot](https://github.com/honeynet/droidbot) | 974 | MIT | Exploración Android que genera el grafo de estados pantalla→acción→pantalla |
| mitmproxy + har→openapi | — | MIT | Grabar tráfico durante la exploración → API funcional (endpoint ↔ funcionalidad) — insumo de M9 |

### 10.3 Pipeline de ingeniería inversa funcional

```text
FASE A — USAR LA APP (agente como usuario nuevo)
├─ frida-agent-browser (D34) / browser-use / stagehand
│    "Explora esta app como usuario: registra cada pantalla,
│     cada acción posible, cada validación y mensaje de error"
├─ El snapshot semántico (a11y tree) da el modelo funcional de cada
│    pantalla SIN leer una línea de código
└─ droidbot (móvil): grafo de estados pantalla→acción→pantalla

FASE B — ESPIAR LA RED mientras se usa
├─ HAR/mitmproxy durante la exploración (M9: har→openapi)
└─ Correlación: pantalla/acción ↔ endpoint ↔ datos que mueve

FASE C — USO REAL (si hay telemetría)
├─ pm4py: process mining → journeys reales (no los ideales)
├─ retentioneering: mapas de clickstream
└─ session replay self-hosted (hyperdx/highlight)

FASE D — FUENTES SECUNDARIAS
├─ pi-web-access: videos/tutoriales de la app → doc funcional
├─ Manuales/FAQ de usuario
└─ Screenshots existentes → pi-sense

ENTREGABLE: catálogo de funcionalidades + mapa de navegación + journeys
+ reglas de negocio observadas + roles/permisos + matriz
funcionalidad↔endpoint↔módulo (cruce con la §9 técnica)
```

### 10.4 Hallazgo clave

La pieza más importante **ya está construida en Frida**: `frida-agent-browser`
(D34) es exactamente el motor de exploración, y su snapshot semántico
(`snapshot -i` con refs) ya es un inventario funcional de pantalla. Lo que
falta no es infraestructura, es **orquestación y entregables**: de ahí nacen
**M8 (`app-walkthrough`)** y **M9 (`frida-traffic2api`)** en la
[Pista M](roadmap-extensiones.md) del roadmap.

### 10.5 Advertencias

- **Skyvern es AGPL-3.0** y pm4py usa una licencia AGPL-alterna: verificar
  antes de integrar código (usarlos como herramienta externa es otra cosa).
- **Auth/2FA:** la exploración necesita sesión de usuario real (perfiles
  autenticados de D34); con datos sensibles, usar entorno de pruebas.
- **Telemetría (FASE C) es opcional:** requiere que el cliente comparta
  logs/replays; sin ella, A+B+D bastan para el catálogo funcional.
- **Apps desktop/móvil** no las cubre D34: requieren `pi-computer-use`,
  Appium o droidbot.

---

## Anexo A — Fuentes

### Extensiones de Pi (npm registry)

- <https://www.npmjs.com/package/pi-lens>
- <https://www.npmjs.com/package/pi-shazam>
- <https://www.npmjs.com/package/@mrclrchtr/supi-code-intelligence>
- <https://www.npmjs.com/package/open-codebase-index>
- <https://www.npmjs.com/package/@narumitw/pi-lsp>
- <https://www.npmjs.com/package/pi-sonar>
- <https://www.npmjs.com/package/pi-subagents>
- <https://www.npmjs.com/package/agent-browser>
- <https://www.npmjs.com/package/pi-web-access>
- <https://www.npmjs.com/package/@amaster.ai/pi-computer-use>
- <https://www.npmjs.com/package/pi-playwright>
- <https://www.npmjs.com/package/pi-sense>

### Proyectos GitHub

- <https://github.com/DeusData/codebase-memory-mcp>
- <https://github.com/tirth8205/code-review-graph>
- <https://github.com/likec4/likec4>
- <https://github.com/openrewrite/rewrite>
- <https://github.com/giancarloerra/SocratiCode>
- <https://github.com/cased/kit>
- <https://github.com/probelabs/probe>
- <https://github.com/MaibornWolff/codecharta>
- <https://github.com/konveyor/move2kube>
- <https://github.com/Azure-Samples/Legacy-Modernization-Agents>
- <https://github.com/pahen/madge>
- <https://github.com/thebjorn/pydeps>
- <https://github.com/browser-use/browser-use>
- <https://github.com/alibaba/page-agent>
- <https://github.com/browserbase/stagehand>
- <https://github.com/Skyvern-AI/skyvern>
- <https://github.com/appium/appium>
- <https://github.com/web-infra-dev/midscene>
- <https://github.com/hyperdxio/hyperdx>
- <https://github.com/highlight/highlight>
- <https://github.com/process-intelligence-solutions/pm4py>
- <https://github.com/retentioneering/retentioneering-tools>
- <https://github.com/honeynet/droidbot>

### Referencias citadas por los proyectos

- arXiv:2603.27277 — *Codebase-Memory: Tree-Sitter-Based Knowledge Graphs
  for LLM Code Exploration via MCP*
- Eric Traut sobre LSP en coding agents:
  <https://github.com/openai/codex/issues/8745#issuecomment-3713058579>
