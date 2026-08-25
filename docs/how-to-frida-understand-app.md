# How-to: entiende un códigobase desconocido (frida-understand-app)

> Aterrizar en un proyecto que no conoces suele significar días leyendo código
> al azar y preguntando a quien lo conoce. **`understand-app`** invierte el
> orden: el agente recorre el códigobase con las tools del moat (pi-lens +
> codebase-index), profundiza en las áreas de riesgo y escribe el
> entendimiento técnico citando evidencia — `file:line` de lo que de verdad
> leyó — incluyendo las 7 preguntas del día 1.

Guía de uso — la referencia técnica vive en
[docs/tools/frida-understand-app.md](tools/frida-understand-app.md).

## El modelo en 30 segundos

1. **El cartógrafo mira desde arriba**: un agente confirma las capacidades
   disponibles (¿hay índice? ¿hay pi-lens?), levanta componentes, lenguajes y
   frameworks, y propone las áreas de riesgo donde profundizar.
2. **Scouts profundizan por área**: un fan-out de agentes desechables investiga
   cada área (autenticación, pagos, endpoints↔BD, …) y escribe hallazgos con
   evidencia `file:line`.
3. **Tres escritores redactan** desde la evidencia en disco: entendimiento
   (§Q1..§Q7), mapa de riesgos y modelo LikeC4 semilla.
4. **Síntesis + juez**: README y veredicto M4/M5 salen deterministas del
   inventario; un juez audita contra los archivos reales
   (`PASS / CONCERNS / FAIL`).

## Cuándo usarlo (y cuándo no)

**Sí**: aterrizar en un proyecto legacy sin documentación, onboarding técnico,
preparar una auditoría de riesgos antes de una migración, responder las 7
preguntas del día 1 ([modernization-apps §7](modernization-apps.md)) con
evidencia citable, sembrar un modelo LikeC4 para arquitectura.

**No**: documentar una app web **usándola** (eso es
[app-walkthrough](how-to-frida-app-walkthrough.md) — M8), capturar
tráfico/API (M9), métricas de calidad/SonarQube (M3), o el panel «Mapa del
proyecto» (M2). El modelo LikeC4 queda en semilla — el refino es con tooling
externo.

## Flujo típico

```text
1. Pide entender el proyecto en el chat de Frida:
   Tú: "no conozco este proyecto — necesito entender dónde se autentica,
        quién llama a pagos y qué rompe si cambio la interfaz de pagos"
2. Presupuesto — el agente te pregunta (ask_user_question):
   "¿Cuántas áreas de riesgo?" → "10 hotspots" / "todo" (= 0) / número propio
3. Lanzamiento — desatendido desde aquí:
   workflow({ name: "understand-app", args: { maxHotspots: 10, maxMinutes: 90 } })
```

Al terminar tienes `docs/entendimiento/` con `README.md` (índice),
`entendimiento.md` (§Q1..§Q7 con evidencia), `mapa-riesgos.md`,
`m4-m5-veredicto.md` (¿bastó el moat?), `likec4/modelo.c4` y
`artifacts/inventory.json` (registro auditable). Con `review: "manual"`
(default) hay un checkpoint final para aprobar.

## Guía paso a paso — de cero a los entregables

La versión detallada del flujo típico, con qué esperar en cada paso. Tiempo
total típico: 15–60 min según el tamaño del repo — la mayor parte es espera
desatendida mientras el workflow investiga.

### Antes de empezar

- Frida Code con la extensión cargada y el motor `frida-extensible-workflows`
  activo (el pack no necesita settings propios).
- El repo del proyecto abierto como workspace (el target es el cwd — no hay
  `url`).
- Opcional pero recomendado: el paquete del moat (`frida-codebase-index`)
  instalado al pin y el índice construido. Índice ausente → el cartógrafo
  puede construirlo con `index_codebase` (incremental). Paquete ausente al
  pin («modo guía») → las 6 tools del índice responden con la guía de
  instalación; la corrida sigue degradada (pi-lens + shell/read/grep).
- Una idea del presupuesto: ¿cuántas áreas de riesgo esperas? (app mediana:
  5–15; `0` = "todo").

### Paso 1 — Pide entender el proyecto

```text
Tú: "entiende este proyecto: dónde se autentican los usuarios, quién llama
     al servicio de pagos y qué código está muerto"
```

El agente principal sabe que el presupuesto se pregunta ANTES del launch
(`maxHotspots` es requerido a propósito: tras el lanzamiento la corrida es
desatendida).

### Paso 2 — Responde la pregunta de presupuesto

El agente pregunta con `ask_user_question`: **¿Presupuesto de hotspots?**
Elige "10 hotspots", "todo" (= sin tope) o un número propio. Si el repo es
grande, añade `maxMinutes` como backstop wall-clock.

### Paso 3 — Lanzamiento (desatendido desde aquí)

```text
workflow({ name: "understand-app", args: { maxHotspots: 10, maxMinutes: 90 } })
```

Qué verás en el panel de workflows — 6 fases en orden:

1. `bootstrap` — crea `docs/entendimiento/**`, sondea capacidades (¿hay
   índice? ¿hay moat?) y levanta datos deterministas del repo.
2. `overview` — el cartógrafo confirma capacidades runtime y levanta el mapa:
   componentes, lenguajes, frameworks y áreas de riesgo priorizadas.
3. `hotspots` — un scout por área (hasta el presupuesto), escribiendo
   hallazgos con evidencia `file:line` a `artifacts/hotspots/`.
4. `analyze` — 3 escritores en paralelo redactan desde la evidencia en disco
   (no re-investigan).
5. `synthesize` — `README.md` + `m4-m5-veredicto.md` desde el inventario.
6. `judge` — auditoría final contra los archivos reales.

Durante la corrida no interactúas: para el workflow el repo es de solo lectura
(solo escribe `docs/entendimiento/` y, única excepción, `.codebase-index/` vía
`index_codebase`).

### Paso 4 — Checkpoint final (default: revisión manual)

Con `review: "manual"` (default) la corrida se detiene al final con un
resumen: N componentes, M hotspots, estado de las 7 preguntas y decisión del
juez. Aprueba para terminar; recházalo si algo se ve mal (el workflow se
detiene sin esperar).

### Paso 5 — Lee los entregables

1. `docs/entendimiento/README.md` — el índice: corrida, conteos, links.
2. `entendimiento.md` — §Q1..§Q7: cada pregunta con status y evidencia
   `file:line`.
3. `mapa-riesgos.md` — riesgos priorizados con origen (H01..) y acción
   sugerida.
4. `m4-m5-veredicto.md` — ¿bastó el moat? Preliminar y determinista.
5. `likec4/modelo.c4` — semilla para tooling LikeC4 externo.
6. Evidencia cruda si necesitas auditar: `artifacts/hotspots/` (hallazgos por
   área) y `artifacts/inventory.json` (registro auditable de la corrida).

### Paso 6 — Si el juez dice CONCERNS

No es un defecto: significa "verificado en general, con debilidades
específicas listadas y con evidencia". Lo típico es descubrimiento detenido
por presupuesto o tiempo — relanza con `maxHotspots`/`maxMinutes` mayores.
«Sin evidencia suficiente» en una pregunta es una respuesta honesta, no un
fallo. `FAIL` sí indica que una claim no se sostiene (p. ej. pregunta
"respondida" sin evidencia real): revisa los findings del juez antes de
confiar en los documentos.

### Problemas frecuentes

| Síntoma | Causa probable | Remedio |
| --- | --- | --- |
| Degradación "frida-codebase-index no disponible" en el inventario | toggle `frida.codebaseIndex.enabled` apagado o instalación/pin ausente | Activa el toggle (recarga con `/reload`) o instala según la [guía de aprendizaje](how-to-frida-learn.md); relanza — la corrida igual funcionó degradada (pi-lens + shell/read/grep) |
| Índice ausente (`.codebase-index/` vacío) | paquete instalado pero el índice no construido en este repo | Deja que el cartógrafo corra `index_codebase` (incremental), o constrúyelo antes con la [guía de aprendizaje](how-to-frida-learn.md) |
| `index_status` (y las demás tools del índice) responden «modo guía» | el paquete no está instalado al pin — TODAS las 6 tools responden con la guía, `index_codebase` incluida (nada se puede construir) | Instala al pin con la [guía de aprendizaje](how-to-frida-learn.md) y relanza; la corrida degradada (pi-lens + shell/read/grep) ya registró la degradación honestamente |
| Corte `budget` / `time` antes de lo esperado | presupuesto chico para el tamaño del repo | Relanza con `maxHotspots` / `maxMinutes` mayores — los entregables de la corrida cortada siguen siendo útiles |
| Escritores fallan con `NO escribieron:` | glitch transitorio de los agentes escritores | Relanza — el gate reintenta una vez solo; si persiste, revisa espacio en disco y permisos de `docs/entendimiento/` |
| Pregunta clave con "sin evidencia suficiente" | el área no estaba entre los hotspots priorizados | Relanza con `maxHotspots` mayor, o pide una corrida enfocada en esa área |

## Recetas

### Entender un proyecto por primera vez

```text
Tú: "no conozco este proyecto — dame el entendimiento técnico completo"
```

El agente confirma el presupuesto (`maxHotspots`), lanza el workflow y al
final resume: N componentes, M hotspots, estado de las 7 preguntas y decisión
del juez.

### Con tope de tiempo

```text
workflow({ name: "understand-app", args: { maxHotspots: 0, maxMinutes: 60 } })
```

`maxMinutes` es un backstop wall-clock: al vencer, el descubrimiento corta
marcando `stoppedByTime` y el juez reporta lo faltante como `CONCERNS` (no
falla la corrida).

### En otro idioma

```text
workflow({ name: "understand-app", args: { maxHotspots: 10, language: "en-US" } })
```

Los entregables salen en el idioma indicado (default `es-MX`).

### Corrida desatendida

```text
workflow({ name: "understand-app", args: { maxHotspots: 10, review: "auto" } })
```

Sin checkpoint final — la decisión del juez queda en el retorno del workflow.

## Qué produce y cómo leerlo

- `docs/entendimiento/README.md` — empieza aquí: corrida, conteos, links.
- IDs estables: componentes `C01..`, hotspots `H01..`, preguntas `Q1..Q7`,
  riesgos `R01..` — citables entre documentos y en issues.
- Cada afirmación cita evidencia: los hallazgos crudos viven en
  `artifacts/hotspots/` con `file:line` localizable.
- `artifacts/inventory.json` — registro auditable: capacidades, tools
  (disponibles/usadas/degradadas), degradaciones, corte. Fuente de verdad del
  índice y del veredicto.

## Customizar los prompts (3 capas)

Igual que frida-tea/frida-aidd: `skills.ts` (defaults) →
`.frida/understand-app/stages.json` (equipo) →
`~/.frida/understand-app/stages.json` (usuario).

```json
{ "stages": { "judge": "nuestra rúbrica interna…" } }
```

Stages: `overview`, `hotspots`, `analyze`, `judge`. Un override es el prompt
completo del stage; JSON inválido aborta antes de correr nada. **El veto de
solo-lectura no se puede quitar desde aquí** — vive en un preamble no-stage.

## Límites honestos

- **El juez es un agente LLM que lee artefactos reales** — su valor es la
  disciplina (verifica archivos, no resúmenes), no la infalibilidad.
- **«Sin evidencia suficiente» es una respuesta válida**: el pack nunca
  inventa rutas ni símbolos; un gap documentado es información.
- **Repo de solo lectura**: el workflow no puede modificar el código bajo
  análisis — solo escribe `docs/entendimiento/` y (única excepción)
  `.codebase-index/` vía `index_codebase`.
- **El LikeC4 es semilla**: sin visualización ni refino — ábrelo con tooling
  LikeC4 externo.
- **El veredicto M4/M5 es preliminar**: determinista desde el inventario; la
  decisión final depende del piloto formal
  ([modernization-apps §8](modernization-apps.md)).
- **Calidad proporcional al moat disponible**: sin índice y sin pi-lens, la
  corrida funciona degradada (shell/read/grep) y el veredicto lo refleja
  honestamente.
- Si el juez dice `CONCERNS` con "corrida cortada por presupuesto", no es un
  defecto: relanza con presupuesto mayor.
