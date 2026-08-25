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
