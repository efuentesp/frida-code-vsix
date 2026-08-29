# How-to: dimensiona una app para una preventa (frida-size-app)

> "¿Cuánto cuesta mantener esto?" suele responderse con intuición.
> **`size-app`** la responde con números auditables: corre el contador
> `scc` (pineado, firmado) sobre el código, deriva COCOMO con rango de
> costo, deuda SQALE proxy y olas de migración — y cada cifra queda
> trazable a `metrics.json`, la única fuente de verdad.

Guía de uso — la referencia técnica vive en
[docs/tools/frida-size-app.md](tools/frida-size-app.md).

## El modelo en 30 segundos

1. **Presupuesto antes del launch**: el comando `/size` pregunta el modo
   COCOMO y el salario mensual con QuickPicks — tras el lanzamiento la
   corrida es desatendida.
2. **Medición determinista**: el binario `scc` v4.0.0 (descargado y firmado
   automáticamente al agentDir) corre por ruta absoluta; un helper node
   agrega todo a `docs/dimensionamiento/artifacts/metrics.json`.
3. **Informe 100% derivado**: `dimensionamiento.md` y `README.md` se
   sintetizan exclusivamente desde `metrics.json` — ninguna cifra vive
   fuera; 3 anexos interpretativos los complementan.
4. **Un juez audita**: `PASS / CONCERNS / FAIL` contra los archivos
   reales; checkpoint final si `review: "manual"` (default).

## Cuándo usarlo (y cuándo no)

**Sí**: preventa de mantenimiento/modernización ("app tomada → cuánto
cuesta"), priorización de olas de migración por deuda, sanity check de
tamaño antes de comprometer estimaciones, insumo cuantitativo para el
negocio junto con el cualitativo de M1.

**No**: si necesitas un quality gate con issues accionables (M3
frida-sonar), un panel visual (M2), cotización de regeneración con LLM
(LOCOMO), o estimación de un proyecto que AÚN NO existe (COCOMO calibra
sobre código existente).

## Flujo típico

```text
1. Lanza el comando slash (vía guiada):
   Tú: /size
   → "¿Modo Basic COCOMO 81?" → "semi-detached (recomendado)" · "organic" ·
      "embedded"
   → "¿Salario MENSUAL por persona?" → "MXN $35,000" (wage 35000,
      currency "MXN") · "USD $6,000" (wage 6000, currency "USD") ·
      "monto propio" (InputBox numérico)
2. Lanzamiento — desatendido desde aquí:
   workflow({ name: "size-app",
              args: { wage: 35000, currency: "MXN",
                      cocomoType: "semi-detached" } })
```

Al terminar tienes `docs/dimensionamiento/` con `dimensionamiento.md` (el
informe), `README.md` (índice), `analisis/` (3 anexos interpretativos) y
`artifacts/` (metrics.json + evidencia cruda). Con `review: "manual"`
(default) hay un checkpoint final para aprobar.

## Guía paso a paso — de cero a los entregables

### Antes de empezar

- Frida Code con la extensión cargada y el motor `frida-extensible-workflows`
  activo (el pack no necesita settings propios).
- El código de la app accesible desde el cwd (no se ejecuta la app).
- Recomendado (no requerido): repo **con historial git** — sin él, las
  familias churn (hotspots/coupling/autores) degradan honestamente y el
  informe las marca "no disponible".
- Opcional: `lizard` en PATH (`pip install lizard`) habilita los
  percentiles CCN **por función**; sin él todo lo demás corre igual.
- `scc` se descarga SOLO (~7 MB firmados) al iniciar la sesión — la
  primera corrida tras instalar Frida ya lo encuentra; si aún no, la
  corrida degrada (no aborta) y puedes reintentar en minutos.
- Una idea del salario mensual por persona para el QuickPick de `/size`.

### Paso 1 — Pide el dimensionamiento

```text
Tú: /size
    (o en lenguaje natural: "dimensiona esta app para una propuesta de
     mantenimiento")
```

### Paso 2 — Responde los QuickPicks de presupuesto

`/size` abre primero **¿Modo Basic COCOMO 81?** ("semi-detached
(recomendado)" para mixed; "organic" para codebases pequeñas y conocidas;
"embedded" para críticas con restricciones duras) y luego
**¿Salario MENSUAL por persona?** ("MXN $35,000" / "USD $6,000" /
"monto propio" — InputBox numérico con punto decimal; "monto propio" sin
moneda deja el default `currency: "USD"`). Todo ANTES del launch — después
la corrida es desatendida. Si lo pediste en lenguaje natural, el agente
pregunta lo mismo con `ask_user_question` y puede añadir el tope de tiempo
(`maxMinutes`, default: sin tope).

### Paso 3 — Lanzamiento (desatendido desde aquí)

```text
workflow({ name: "size-app", args: { wage: 35000, currency: "MXN" } })
```

Qué verás — 5 fases en orden: `bootstrap` (gates y sondas) → `metrics`
(scc + lizard → metrics.json) → `analyze` (3 anexos) → `synthesize`
(informe + README) → `judge` (auditoría). En una app grande las fases
deterministas tardan segundos (~1M LOC); analyze es lo que consume
presupuesto.

### Paso 4 — Checkpoint final (default: revisión manual)

Con `review: "manual"` (default) la corrida se detiene al final con un
resumen: KLOC efectivos, degradaciones, anexos y decisión del juez.
Aprueba para terminar; recházalo si algo se ve mal (el workflow se detiene
sin esperar).

### Paso 5 — Lee los entregables (en orden)

1. `docs/dimensionamiento/README.md` — el índice: corrida y estado de
   familias.
2. `docs/dimensionamiento/dimensionamiento.md` — el informe: resumen
   ejecutivo, COCOMO con rango de costo, percentiles, SQALE, deuda por
   módulo, olas de migración, hotspots, bus factor, exclusiones.
3. `docs/dimensionamiento/analisis/*.md` — la interpretación agéntica.
4. `docs/dimensionamiento/artifacts/metrics.json` — la fuente de verdad:
   audita cualquier cifra del informe contra él.

### Paso 6 — Cómo auditar una cifra

Toda cifra del informe está en `metrics.json` tal cual o se re-deriva con
la fórmula declarada junto a ella (COCOMO en `derived.cocomo`, SQALE en
`derived.sqale`, olas en `derived.waves`). El juez detached ya muestreó
estas derivaciones — un PASS es esa auditoría en verde.

### Paso 7 — Si el juez dice CONCERNS

No es un defecto: significa "verificado en general, con debilidades
específicas". Lo típico: **familias degradadas** declaradas (sin git, sin
lizard, scc aún descargando — remedia y relanza) o **corte por
presupuesto** (`stoppedBy: "time"`; relanza con `maxMinutes` mayor).
`FAIL` sí indica una claim falsa: revisa los findings antes de usar el
informe.

## Problemas frecuentes

| Síntoma | Causa probable | Remedio |
| --- | --- | --- |
| Degradación "scc no instalado al pin" | descarga fire-and-forget en curso o fallida | Espera unos minutos y relanza; verifica red/proxy; el doctor (checkScc) muestra el estado |
| Familias churn "no disponible" | cwd sin historial git | Corre sobre un clone con commits; lo demás del informe no se afecta |
| "CCN por función" no disponible | `lizard` ausente del PATH (opcional) | `pip install lizard` y relanza |
| `args.wage` falta (error eager) | el launch se hizo sin presupuesto | Relanza con `/size` (QuickPicks de modo y salario) o responde la pregunta del agente (MXN/USD/propio) — el error instruye cómo |
| Corte `stoppedBy: "time"` | `maxMinutes` chico para el tamaño | Relanza con tope mayor; los entregables de la corrida cortada siguen siendo útiles |
| Doctor muestra scc no instalado | primera sesión aún descargando | "Verificar entorno" de nuevo tras reiniciar; la guía del check explica la descarga automática |

## Recetas

### Preventiva en MXN con exclusiones propias

```text
Tú: "dimensiona la app en MXN, excluye legacy y third_party"
→ workflow({ name: "size-app",
             args: { wage: 35000, currency: "MXN", exclude: ["legacy", "third_party"] } })
```

`exclude[]` AMPLÍA la default curada (dist, build, node_modules, vendor,
target, out, .next, coverage + *.min.js); el informe declara cada
exclusión con su volumen medido.

### Desatendida en USD (CI nocturna)

```text
workflow({ name: "size-app", args: { wage: 6000, currency: "USD", review: "auto",
                                     maxMinutes: 120 } })
```

Sin checkpoint: la decisión del juez queda en el retorno del workflow.

### Codebase pequeña y conocida → organic

```text
workflow({ name: "size-app", args: { wage: 35000, currency: "MXN", cocomoType: "organic" } })
```

Constantes por modo: organic {2.4, 1.05}, semi-detached {3.0, 1.12},
embedded {3.6, 1.20} — el informe siempre declara cuáles usó.

### En otro idioma

```text
workflow({ name: "size-app", args: { wage: 6000, language: "en-US" } })
```

Los entregables salen en el idioma indicado (default `es-MX`).

## Qué produce y cómo leerlo

- **Resumen ejecutivo**: KLOC efectivos (SLOC con exclusiones), deuda
  SQALE proxy con rating A-E, rango COCOMO (esfuerzo PM + costo con wage y
  overhead 2.4), bus factor, número de olas.
- **COCOMO**: tabla de 3 filas (EAF 0.85/1.00/1.15) con esfuerzo, TDEV,
  personas pico y costo; fórmulas a pie; el spread EAF etiquetado como
  supuesto del analista (no estándar).
- **Olas de migración**: módulos priorizados por deuda en 3 olas con
  semanas estimadas sobre el TDEV central.
- **Exclusiones**: tabla con volumen medido por directorio y patrón.
- **Degradaciones**: cada familia no disponible con causa y hint — nunca
  silenciosas.
- `metrics.json` es la fuente de verdad para TODO lo anterior.

## Customizar los prompts (3 capas)

Igual que frida-tea/frida-aidd: `skills.ts` (defaults) →
`.frida/size-app/stages.json` (equipo) → `~/.frida/size-app/stages.json`
(usuario).

```json
{ "stages": { "analyze": "nuestro criterio para los anexos…" } }
```

Stages: `analyze`, `judge`. Un override es el prompt completo del stage;
JSON inválido aborta antes de correr nada. **El veto de solo-escritura y
el juez de números no se pueden quitar desde aquí** — viven en un preamble
no-stage; la regla corte→CONCERNS sobrevive overrides (runtime block).

## Límites honestos

- **COCOMO calibra sobre código existente**: es un modelo de 1981
  (Basic 81, Boehm) replicando las constantes exactas de scc — útil para
  rangos de conversación de preventa, no para cotizar a 2 decimales.
- **El SQALE es un proxy** (umbral cognitiva 15, 0.5 h/punto): etiquetado
  como tal en el informe; NO es SonarQube.
- **El spread EAF es un supuesto tuyo** (0.85/1.00/1.15, conservador); lo
  documentado es 0.9–1.4 típico — el informe lo declara.
- **wage es mensual y currency es etiqueta**: sin conversión de moneda.
- **Los números dependen del pin**: misma versión de scc = mismos números
  entre máquinas (ese es el argumento de auditoría); un bump de pin se
  declara en `run.sccVersion`.
- **El juez es un agente LLM disciplinado** (lee artefactos reales) — no
  infalible.
