# How-to: documenta una app web usándola (frida-app-walkthrough)

> Documentar una app existente suele significar semanas leyendo código y
> entrevistando a quien la conoce. **`app-walkthrough`** invierte el orden: el
> agente usa la app como un usuario (en una sesión de navegador que TÚ
> autenticaste), observa pantallas, flujos y validaciones, y escribe la
> documentación funcional citando evidencia — snapshots y screenshots de lo que
> de verdad vio.

Guía de uso — la referencia técnica vive en
[docs/tools/frida-app-walkthrough.md](tools/frida-app-walkthrough.md).

## El modelo en 30 segundos

1. **Tú autenticas**: abres la app en una sesión de navegador con nombre fijo
   (`app-walkthrough`) e inicias sesión como el usuario que quieras documentar.
2. **El workflow recorre**: un script determinista navega; por cada pantalla un
   agente interpreta (¿qué logra el usuario aquí? ¿qué roles la usan?) y decide
   el siguiente paso. Submits destructivos vetados.
3. **Cuatro escritores redactan** desde la evidencia en disco: catálogo de
   pantallas, flujos (journeys), reglas de negocio y roles/permisos.
4. **Un juez audita**: `PASS / CONCERNS / FAIL` contra los archivos reales, no
   contra promesas.

## Cuándo usarlo (y cuándo no)

**Sí**: app legacy sin documentación, onboarding a un producto desconocido,
redocumentar tras un rediseño mayor, preparar material para no técnicos
(POs, soporte, QA manual), inventario de pantallas antes de un proyecto de
migración o testing.

**No**: apps desktop o móviles (la sesión es de navegador), captura de
tráfico/contratos de API (eso será M9), diff contra documentación previa
(`app-rewalk` futuro), o si necesitas pruebas automatizadas — eso es
[TEA](how-to-frida-tea.md).

## Flujo típico

```text
1. Pre-autentica (una vez) — pídelo en el chat:
   Tú: "abre https://app.ejemplo.com en la sesión 'app-walkthrough'"
   → el agente corre agent_browser({ args: ["--session", "app-walkthrough",
       "open", "https://app.ejemplo.com"] })
   → TÚ inicias sesión en esa ventana (es tu navegador real)
2. Presupuesto — el agente te pregunta (ask_user_question):
   "¿Cuántas pantallas?" → "30" / "todo" / número propio
3. Lanzamiento — desatendido desde aquí:
   workflow({ name: "app-walkthrough",
              args: { url: "https://app.ejemplo.com", maxScreens: 30 } })
```

Al terminar tienes `docs/funcional/` con `README.md` (índice), 4 documentos,
screenshots, el dashboard `index.html` (ábrelo en cualquier navegador) y la
decisión del juez. Con `review: "manual"` (default) hay un checkpoint final
para aprobar.

## Guía paso a paso — de cero a los entregables

La versión detallada del flujo típico, con los comandos exactos y qué esperar
en cada paso. Tiempo total típico: 10–40 min según el tamaño de la app — la
mayor parte es espera desatendida mientras el workflow explora.

### Antes de empezar

- Frida Code con la extensión cargada y el motor `frida-extensible-workflows`
  activo (el pack no necesita settings propios).
- La URL de la app y tus credenciales para iniciar sesión TÚ — el workflow
  nunca introduce credenciales ni hace login por ti (política del pack).
- Una idea del presupuesto: ¿cuántas pantallas únicas esperas? (app mediana:
  20–50; `0` = "todo").

### Paso 1 — Abre la sesión del navegador y autentícate

Pídelo en el chat de Frida:

```text
Tú: abre https://app.ejemplo.com en la sesión "app-walkthrough"
```

El agente corre `agent_browser({ args: ["--session", "app-walkthrough",
"open", "https://app.ejemplo.com"] })` y se abre una ventana de navegador
real. Inicia sesión con tu usuario, espera a quedar DENTRO de la app (pasado
el login) y vuelve al chat.

✓ Check: la sesión queda viva con ese nombre exacto — el workflow la reusará
con el pin `--session` en cada comando. Si prefieres otro nombre, sé
consistente y pásalo en el Paso 4 (`session: "tu-nombre"`).

### Paso 2 — Pide documentar la app

```text
Tú: documenta la app en https://app.ejemplo.com
    (ya inicié sesión en la sesión "app-walkthrough")
```

### Paso 3 — Responde la pregunta de presupuesto

El agente pregunta con `ask_user_question`: **¿Presupuesto de exploración?**
Elige "30 pantallas", "todo" (= sin tope) o un número propio. El presupuesto
se pregunta ANTES del launch porque tras el lanzamiento la corrida es
desatendida (el único checkpoint es el final, y es booleano).

### Paso 4 — Lanzamiento (desatendido desde aquí)

El agente lanza:

```text
workflow({ name: "app-walkthrough",
           args: { url: "https://app.ejemplo.com", maxScreens: 30 } })
```

Qué verás en el panel de workflows — 5 fases en orden:

1. `bootstrap` — valida que la sesión siga viva (si falla, el error trae la
   receta exacta: vuelve al Paso 1 y relanza) y abre la URL.
2. `explore` — el loop pantalla por pantalla: snapshot → screenshot de
   pantalla nueva → un agente interpreta y decide el siguiente click. El
   progreso se ve paso a paso; corta sola al agotar presupuesto.
3. `analyze` — 4 escritores en paralelo redactan desde la evidencia en disco
   (no navegan).
4. `synthesize` — `README.md` + dashboard `index.html` desde el inventario.
5. `judge` — auditoría final contra los archivos reales.

Durante la corrida NO interactúas con la ventana del navegador: el script
navega por su cuenta. Puedes mirarla, pero no clickear (tu click cambia la
pantalla bajo los pies del explorador).

### Paso 5 — Checkpoint final (default: revisión manual)

Con `review: "manual"` (default) la corrida se detiene al final con un
resumen: N pantallas, decisión del juez y rutas de los entregables. Aprueba
para terminar; recházalo si algo se ve mal (el workflow se detiene sin
esperar).

### Paso 6 — Lee los entregables

1. `docs/funcional/README.md` — el índice: corrida, conteos, links a todo.
2. `docs/funcional/index.html` — ábrelo en tu navegador: tarjetas por
   pantalla con screenshot.
3. Los 4 documentos: `catalogo-pantallas.md`, `journeys.md`,
   `reglas-negocio.md`, `roles-permisos.md`.
4. Evidencia cruda si necesitas auditar: `artifacts/steps/` (snapshots por
   paso), `screenshots/` (por pantalla) y `artifacts/inventory.json`
   (registro auditable de la corrida).

### Paso 7 — Si el juez dice CONCERNS

No es un defecto: significa "verificado en general, con debilidades
específicas listadas y con evidencia". Lo típico es exploración detenida
por presupuesto o tiempo — relanza con un `maxScreens` / `maxMinutes`
mayor, o con otra sesión autenticada bajo otro rol para cubrir pantallas
exclusivas de ese rol. `FAIL` sí indica que una claim no se sostiene (p. ej.
conteos que no coinciden): revisa los findings del juez antes de confiar en
los documentos.

### Problemas frecuentes

| Síntoma | Causa probable | Remedio |
| --- | --- | --- |
| `la sesión de navegador 'app-walkthrough' no está viva` | ventana cerrada, otro nombre de sesión, o Frida reiniciado | Repite el Paso 1 y relanza — nada se pierde |
| `la exploración no registró ninguna pantalla` | la app no cargó (URL incorrecta, redirección a login) | Abre la URL tú mismo en la sesión, verifica que cargue y relanza |
| Corte `budget` / `time` / `stepLimit` antes de lo esperado | presupuesto chico para el tamaño de la app | Relanza con `maxScreens` / `maxMinutes` mayores |
| Pantallas de un rol ausentes del catálogo | la sesión autenticada no tiene ese rol | Pre-autentica con un usuario de ese rol y relanza |
| Escritores fallan con `NO escribieron:` | glitch transitorio de los agentes escritores | Relanza — el gate reintenta una vez solo; si persiste, revisa espacio en disco y permisos de `docs/funcional/` |

## Recetas

### Documentar una app por primera vez

```text
Tú: "documenta la app en https://app.ejemplo.com — ya inicié sesión en la sesión 'app-walkthrough'"
```

El agente confirma el presupuesto (`maxScreens`), lanza el workflow y al final
resume: N pantallas en M pasos, decisión del juez y rutas de los entregables.
Si algo no quedó documentado (corte por presupuesto), el juez lo lista como
`CONCERNS` — relanza con un `maxScreens` mayor para ampliar.

### Con tope de tiempo además de pantallas

```text
workflow({ name: "app-walkthrough", args: {
  url: "https://app.ejemplo.com", maxScreens: 0, maxMinutes: 20 } })
```

`maxMinutes` es un backstop wall-clock: al vencer, la exploración corta
marcando `stoppedByTime` y el juez reporta lo faltante como `CONCERNS` (no
falla la corrida).

### En otro idioma

```text
workflow({ name: "app-walkthrough", args: {
  url: "https://app.ejemplo.com", maxScreens: 30, language: "en-US" } })
```

Los entregables salen en el idioma indicado (default `es-MX`).

### Corrida desatendida

```text
workflow({ name: "app-walkthrough", args: {
  url: "https://app.ejemplo.com", maxScreens: 30, review: "auto" } })
```

Sin checkpoint final — la decisión del juez queda en el retorno del workflow.

### Sobre una sesión que ya tenías con otro nombre

```text
# pre-auth con ese nombre:
agent_browser({ args: ["--session", "demo-cliente", "open", "https://app.ejemplo.com"] })
# y el mismo nombre en args:
workflow({ name: "app-walkthrough", args: {
  url: "https://app.ejemplo.com", maxScreens: 30, session: "demo-cliente" } })
```

Si la sesión no está viva al arrancar, el workflow falla en el bootstrap con
la receta exacta para pre-autenticar — nada se pierde.

## Qué produce y cómo leerlo

- `docs/funcional/README.md` — empieza aquí: corrida, conteos, links.
- IDs estables: pantallas `P01..`, flujos `J01..`, reglas `R01..`, roles
  `A01..` — citables entre documentos y en issues.
- Cada afirmación cita evidencia: screenshots por pantalla, snapshots crudos
  por paso (`artifacts/steps/`), validaciones post-error.
- `artifacts/inventory.json` — registro auditable de la corrida (fuente de
  verdad del índice y el dashboard).

## Customizar los prompts (3 capas)

Igual que frida-tea/frida-aidd: `skills.ts` (defaults) →
`.frida/app-walkthrough/stages.json` (equipo) →
`~/.frida/app-walkthrough/stages.json` (usuario).

```json
{ "stages": { "explore": "nuestro criterio de exploración interno…" } }
```

Stages: `explore`, `analyze`, `judge`. Un override es el prompt completo del
stage; JSON inválido aborta antes de correr nada. **El veto de acciones
irreversibles no se puede quitar desde aquí** — vive en un preamble no-stage.

## Límites honestos

- **El juez es un agente LLM que lee artefactos reales** — su valor es la
  disciplina (verifica archivos, no resúmenes), no la infalibilidad.
- **Submits irreversibles vetados**: no verás documentado el flujo de "crear
  pedido" hasta el final — el agente marca esas acciones `[VETOED]` y sigue;
  el snapshot de la pantalla de alta sí queda.
- **Documenta lo que TU sesión ve**: si el menú requiere un rol que no
  autenticaste, esas pantallas no aparecerán. Corre de nuevo con otra sesión
  autenticada para cubrir otro rol.
- **Screenshots de viewport** (no full-page): pantallas largas se capturan por
  arriba; el snapshot semántico (a11y) cubre el resto.
- **Una sesión a la vez**: la exploración es secuencial (por diseño — dedup y
  presupuesto duros). Navegación paralela requeriría rework del motor.
- Si el juez dice `CONCERNS` con "exploración detenida por presupuesto", no es
  un defecto: relanza con `maxScreens` mayor.
