# How-to: documenta la API real de una app (frida-traffic2api)

> Documentar la API de un legacy suele significar semanas leyendo código y
> abriendo devtools a mano. **`traffic2api`** invierte el orden: el agente
> ejerce la app sobre una sesión que TÚ autenticaste (o ingiere un HAR que ya
> capturaste) y escribe la spec OpenAPI + la matriz
> funcionalidad↔endpoint↔módulo citando evidencia — la petición que de verdad
> voló y el módulo que de verdad la implementa.

Guía de uso — la referencia técnica vive en
[docs/tools/frida-traffic2api.md](tools/frida-traffic2api.md).

## El modelo en 30 segundos

1. **Dos modos de lanzamiento**: `walk` (TÚ pre-autenticas una sesión de
   navegador; el workflow navega la app y graba el tráfico en un HAR) o
   `externo` (TÚ ya capturaste el HAR con devtools/mitmproxy; el workflow lo
   ingiere sin abrir navegador).
2. **Carve determinista**: el HAR se trocea en peticiones delgadas
   (`requests.jsonl`), cada una con la pantalla del walk que la originó
   (join temporal por epochs).
3. **Spec + matriz**: `openapi.json` (OpenAPI 3.1, códigos de error
   incluidos) y `matriz.md` (funcionalidad↔endpoint↔módulo con grounding del
   moat: pi-lens + codebase-index), huérfanos y zona muerta calificada.
4. **Un juez audita**: `PASS / CONCERNS / FAIL` contra los archivos reales,
   no contra promesas.

## Cuándo usarlo (y cuándo no)

**Sí**: app legacy sin spec antes de modernizar o integrar; saber qué
endpoints llama cada pantalla y qué módulo implementa cada uno; detectar
endpoints huérfanos (API sin UI) y zona muerta (rutas sin tráfico);
construir la base para mocks de la API real cuando no existe contrato.

**No**: si necesitas probar o moquear la API (eso es
[TEA](how-to-frida-tea.md)), si esperas una spec autorativa con schemas
completos (esto documenta lo observado, sin inferencias), apps desktop (la
sesión es de navegador — para tráfico móvil usa mitmproxy y el modo
`externo`), o el panel visual de la matriz (M2).

## Flujo típico

```text
Modo walk (el workflow navega y graba):
1. Pre-autentica (una vez) — pídelo en el chat:
   Tú: "abre https://app.ejemplo.com en la sesión 'app-walkthrough'"
   → TÚ inicias sesión en esa ventana
2. Presupuesto — el agente te pregunta (ask_user_question):
   "¿Cuántas pantallas?" → "20" / "todo" / número propio
3. Lanzamiento — desatendido desde aquí:
   workflow({ name: "traffic2api",
              args: { url: "https://app.ejemplo.com", maxScreens: 20 } })

Modo externo (TÚ ya capturaste el HAR):
   workflow({ name: "traffic2api", args: { harPath: "capturas/sesion.har" } })
```

Al terminar tienes `docs/api/` con `openapi.json`, `matriz.md`,
`navegacion.md`, `README.md` y `artifacts/` (evidencia auditable). Con
`review: "manual"` (default) hay un checkpoint final para aprobar.

## Guía paso a paso — de cero a los entregables

### Antes de empezar

- Frida Code con la extensión cargada y el motor `frida-extensible-workflows`
  activo (el pack no necesita settings propios).
- Modo walk: la URL de la app y tus credenciales — TÚ autenticas, el
  workflow nunca hace login. Modo externo: un HAR exportado (devtools:
  pestaña Network → «Export HAR…», o mitmproxy).
- Recomendado (no requerido): `docs/funcional/` (M8) como catálogo de
  pantallas y `docs/entendimiento/` (M1) como semilla de zona muerta — sin
  ellos la corrida funciona degradada y lo registra en el inventario.
- Una idea del presupuesto (walk): ¿cuántas pantallas únicas esperas? (app
  mediana: 10–30; `0` = "todo").

### Paso 1 (sólo walk) — Abre la sesión del navegador y autentícate

```text
Tú: abre https://app.ejemplo.com en la sesión "app-walkthrough"
```

El agente corre `agent_browser({ args: ["--session", "app-walkthrough",
"open", "https://app.ejemplo.com"] })` y se abre una ventana de navegador
real. Inicia sesión con tu usuario, espera a quedar DENTRO de la app y
vuelve al chat. La captura HAR se graba SOBRE esa sesión. Para correr M8 y
M9 en paralelo, pre-autentica OTRA sesión con otro nombre y pásalo en
`session:` (el default compartido `"app-walkthrough"` sería pisado por ambas
corridas).

### Paso 2 — Pide documentar la API

```text
Tú: documenta la API de https://app.ejemplo.com
    (ya inicié sesión en la sesión "app-walkthrough")
   — o, en modo externo —
Tú: documenta la API desde el HAR capturas/sesion.har
```

### Paso 3 — Responde la pregunta de presupuesto (sólo walk)

El agente pregunta con `ask_user_question`: **¿Presupuesto de exploración?**
Elige "20 pantallas", "todo" (= sin tope) o un número propio. El presupuesto
se pregunta ANTES del launch porque tras el lanzamiento la corrida es
desatendida. El modo externo no pregunta: no hay walk.

### Paso 4 — Lanzamiento (desatendido desde aquí)

```text
workflow({ name: "traffic2api",
           args: { url: "https://app.ejemplo.com", maxScreens: 20 } })
```

Qué verás — 8 fases en orden: `bootstrap` (gates y sondas) → `walk`
(navegación con captura HAR) → `ingest` (carve del HAR) → `spec`
(`openapi.json`) → `graph` (`navegacion.md`) → `matrix` (correlación con
moat) → `synthesize` (`matriz.md` + `README.md`) → `judge` (auditoría). En
modo externo `walk` no aparece. Durante la corrida NO interactúes con la
ventana del navegador: el script navega por su cuenta.

### Paso 5 — Checkpoint final (default: revisión manual)

Con `review: "manual"` (default) la corrida se detiene al final con un
resumen: N endpoints, matriz con M filas, decisión del juez y rutas de los
entregables. Aprueba para terminar; recházalo si algo se ve mal (el workflow
se detiene sin esperar).

### Paso 6 — Lee los entregables

1. `docs/api/README.md` — el índice: corrida, conteos, veredicto de
   cobertura.
2. `docs/api/openapi.json` — la spec OpenAPI 3.1 de la API observada.
3. `docs/api/matriz.md` — funcionalidad↔endpoint↔módulo + huérfanos + zona
   muerta calificada.
4. `docs/api/navegacion.md` — el grafo de la exploración y su frontera
   clasificada.
5. Evidencia cruda: `artifacts/requests.jsonl` (una petición por línea con
   su pantalla) y `artifacts/inventory.json` (registro auditable).

### Paso 7 — Si el juez dice CONCERNS

No es un defecto: significa "verificado en general, con debilidades
específicas listadas con evidencia". Lo típico: corte por presupuesto
(relanza con `maxScreens`/`maxMinutes` mayores), pantallas de otro rol
(re-autentica con otro usuario), o degradaciones listadas (corre
M8/M1 primero). `FAIL` sí indica una claim falsa (p. ej. endpoints del
tráfico ausentes de la spec): revisa los findings antes de confiar.

### Problemas frecuentes

| Síntoma | Causa probable | Remedio |
| --- | --- | --- |
| `la sesión de navegador 'app-walkthrough' no está viva` | ventana cerrada u otro nombre de sesión | Repite el Paso 1 y relanza — nada se pierde |
| `el HAR capturado está vacío o ausente` | la app no hizo peticiones, o la grabación falló | Verifica que la app haga llamadas de red y relanza (el error cita la evidencia en `docs/api/artifacts/steps/`) |
| `0 same-origin` con censo de dominios | HAR de otra app o dominio | En walk el origin sale de `args.url`; en externo se toma el dominio más frecuente — verifica que el HAR sea de la app correcta |
| Degradación "frida-codebase-index no disponible" | toggle `frida.codebaseIndex.enabled` apagado o instalación/pin ausente | Activa el toggle (recarga con `/reload`) o instala según la [guía de aprendizaje](how-to-frida-learn.md); la corrida siguió degradada |
| Matriz sin columna "Funcionalidad" | sin `docs/funcional/` (M8) y modo externo | Corre [app-walkthrough](how-to-frida-app-walkthrough.md), o usa el modo walk (la correlación sale del propio walk) |
| Zona muerta "no enumerable" | ningún patrón de framework matcheó ni hay semilla M1 | Gap registrado honestamente; siembra con [understand-app](how-to-frida-understand-app.md) o cursa las rutas a mano |
| Corte `budget` / `time` antes de lo esperado | presupuesto chico para el tamaño de la app | Relanza con `maxScreens`/`maxMinutes` mayores — los entregables de la corrida cortada siguen siendo útiles |

## Recetas

### Documentar la API por primera vez (walk)

```text
Tú: "documenta la API de https://app.ejemplo.com — ya inicié sesión en la sesión 'app-walkthrough'"
```

El agente pregunta el presupuesto, lanza y al final resume: N endpoints, M
filas de matriz, decisión del juez y rutas de los entregables.

### Desde un HAR ya capturado (externo)

```text
Tú: "documenta la API desde el HAR capturas/sesion.har"
→ workflow({ name: "traffic2api", args: { harPath: "capturas/sesion.har" } })
```

Ideal cuando ya grabaste una sesión real con devtools/mitmproxy, o para
tráfico que no puedes walk-ear. Sin navegador ni sesión.

### Con tope de tiempo

```text
workflow({ name: "traffic2api", args: { url: "https://app.ejemplo.com", maxScreens: 0, maxMinutes: 30 } })
```

`maxMinutes` corta el WALK, nunca los entregables: las fases posteriores
corren sobre el tráfico alcanzado.

### En paralelo con una corrida de M8

```text
# pre-autentica OTRA sesión con otro nombre y pásala:
workflow({ name: "traffic2api", args: { url: "…", maxScreens: 20, session: "t2a" } })
```

Cada corrida pisa la ventana de su propia sesión; nombres distintos evitan
que M8 y M9 se pisen entre sí.

### En otro idioma / desatendida

```text
workflow({ name: "traffic2api", args: { url: "…", maxScreens: 20, language: "en-US" } })
workflow({ name: "traffic2api", args: { harPath: "x.har", review: "auto" } })
```

Los entregables salen en el idioma indicado (default `es-MX`); con
`review: "auto"` no hay checkpoint final — la decisión del juez queda en el
retorno del workflow.

## Qué produce y cómo leerlo

- IDs estables: pantallas `P01..`, endpoints `E01..`, filas de matriz
  `M01..` — citables entre documentos y en issues.
- Cada celda de la matriz cita evidencia: la petición (E-ID), la pantalla
  (P-ID) y el módulo (`file:line` vía moat).
- Huérfanos bidireccionales: API sin UI (`apiSinUi`) y funcionalidad sin
  código localizable (`uiSinCodigo`).
- Zona muerta calificada por alcanzabilidad: `probablemente-viva` /
  `candidata-real` / `desconocida`.
- `artifacts/inventory.json` — registro auditable: capacidades, tools
  (disponibles/usadas/degradadas), degradaciones, corte. Fuente de verdad de
  `matriz.md` y `README.md`.

## Customizar los prompts (3 capas)

Igual que frida-tea/frida-aidd: `skills.ts` (defaults) →
`.frida/traffic2api/stages.json` (equipo) →
`~/.frida/traffic2api/stages.json` (usuario).

```json
{ "stages": { "matrix": "nuestro criterio de correlación…" } }
```

Stages: `walk`, `boundary`, `matrix`, `judge`. Un override es el prompt
completo del stage; JSON inválido aborta antes de correr nada. **Los vetos
y la seguridad del HAR no se pueden quitar desde aquí** — viven en un
preamble no-stage.

## Límites honestos

- **Documenta lo observado**: 4xx/5xx incluidos; sin schemas inferidos de
  ejemplos. Una operación que el walk no ejerció no aparece — correlación ≠
  cobertura.
- **El juez es un agente LLM disciplinado** (lee artefactos reales, no
  resúmenes) — no infalible.
- **Irreversibles vetados**: el tráfico de "crear pedido" no se captura; si
  necesitas ese endpoint, captúralo TÚ con devtools y usa el modo externo.
- **Documenta lo que TU sesión ve**: pantallas de otro rol no aparecen.
- **El HAR crudo (`artifacts/raw.har`) puede contener tokens de TU
  sesión**: los entregables están scrubbeados, pero NO subas `raw.har` a un
  repo público.
- Si el juez dice `CONCERNS` con "corrida cortada por presupuesto", no es un
  defecto: relanza con presupuesto mayor.
