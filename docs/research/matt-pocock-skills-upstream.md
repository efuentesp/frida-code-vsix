# Matt Pocock skills — upstream canónico + gaps + teoría de diseño de skills

**Tipo:** nota de investigación (no requiere acción de implementación inmediata; alimenta
`#16`/`#32`/`#36` y registra gaps candidatos).
**Fecha:** 2026-08-12.
**Pregunta:** ¿Qué aporta [`mattpocock/skills`](https://github.com/mattpocock/skills) a Frida?
**Fuente:** [`mattpocock/skills`](https://github.com/mattpocock/skills) (MIT, 214.659★, Shell+JS). Por Matt Pocock (Total TypeScript).

## TL;DR — veredicto

**No es un porte.** Frida **ya usa** estas skills (mismo ecosistema skills.sh/GSD): 8
nombres coinciden 1:1 con skills del agente Pi (`code-review`, `codebase-design`,
`diagnosing-bugs`, `domain-modeling`, `prototype`, `research`, `resolving-merge-conflicts`,
`tdd`). El repo aporta valor en **3 pilares**: (1) **validación filosófica** — skills
composibles vs procesos monolíticos; (2) **gap analysis** — skills candidatas a adoptar
(`wayfinder`, router `ask-matt`, `triage`, `to-spec`); (3) **teoría de diseño de skills**
(`writing-for-agents`) que debería informar `#16` y `#32`.

## Pilar 1 — Validación filosófica (skills composibles vs procesos monolíticos)

El README posiciona las skills **explícitamente contra** GSD/BMAD/Spec-Kit:

> *"Approaches like GSD, BMAD, and Spec-Kit try to help by owning the process. But while
> doing so, they take away your control and make bugs in the process hard to resolve.
> These skills are designed to be **small, easy to adapt, and composable**. They work with
> any model."*

Esto **valida la filosofía de Frida** (rechazo de redundancia, piezas componibles) y
**refuerza el caso de la consolidación de `frida-workflow`** (ADR-0051): el modelo BMAD
"dueño del proceso" es precisamente lo que Matt critica. La serie de research converge
— BMAD (`frida-aidd`/`cis`/`tea`) aporta *contenido metodológico*; Matt Pocock aporta la
*filosofía de composición*.

## Pilar 2 — La arquitectura: `ask-matt` como router (= pipeline RPIV)

`ask-matt` mapea el **"main flow: idea → ship"** que es **literalmente el pipeline RPIV**
de Frida (discover→design→plan→implement→validate):

```
grill-with-docs ── (prototype detour vía handoff) ── to-spec ── to-tickets
  └─ implement (drives tdd internamente) ── code-review (Standards + Spec) ── commit
```

- **`grill-with-docs`** ≈ `/skill:discover` (sharpen idea por entrevista, **stateful** en
  `CONTEXT.md` + ADRs — versión persistente del `grilling` de Frida).
- **`to-spec` + `to-tickets`** ≈ `/skill:design` + `/skill:plan` (spec → tracer-bullet
  tickets con **blocking edges**).
- **`implement`** drives `tdd` (red-green slice a slice) → cierra con `code-review`
  (Standards + Spec del diff) → commit.
- **Context hygiene:** mantener grill→spec→tickets en **una ventana ininterrumpida** (no
  compact hasta `to-tickets`); cada `implement` empieza fresh. Límite = el *smart zone*
  (~150k tokens) — conexión directa con `#18` (token accounting).

**On-ramps:** bugs piling up → `triage` · algo roto → `diagnosing-bugs` (→ post-mortem →
`improve-codebase-architecture`) · **esfuerzo enorme/neblinoso → `wayfinder`**.

### Gap analysis — skills netas nuevas (Matt tiene, Frida no)

| Skill | Qué aporta | Conexión Frida | Prioridad |
| --- | --- | --- | --- |
| **`wayfinder`** | Planning para esfuerzos **demasiado grandes para una sesión** → **decision tickets** en el issue tracker (producen *decisiones, no deliverables*) hasta disipar la niebla. Mapa = issue `wayfinder:map`; tickets = child issues; el mapa es **índice, no store** (cada decisión vive en un solo ticket) | **#36 kanban** + integración issue tracker | **alta** (gap real) |
| **`ask-matt`** | **Router** que mapea todas las skills user-reachable + sus flujos; se re-sincroniza al añadir/renombrar/cambiar una skill | Frida tiene el pipeline RPIV pero **no un router explícito** | media |
| **`triage`** | Mueve issues entrantes por triage roles → produce agent-ready issues | issue tracker / pipeline | media |
| `to-spec`, `to-tickets` | Conversión idea→spec→tracer-bullet tickets (con blocking edges) | pipeline (≈ design+plan) | baja (cubierto por RPIV) |
| `grill-with-docs` | `grilling` **stateful** (escribe CONTEXT.md + ADRs) | versión persistente de `grilling` | media |
| `improve-codebase-architecture` | Post-mortem de bugs → redesign de seams | `codebase-design` | baja |
| `wizard` | Bash wizards interactivos para pasos manuales (provisioning, secrets, CI) vía `template.sh` con helpers | niche (Frida es VS Code, no CLI) | baja |

## Pilar 3 — Teoría de diseño de skills (`writing-for-agents`) → `#16`/`#32`

La skill `writing-for-agents` es la **teoría de diseño de docs para agentes más clara**
evaluada en toda la serie. Debería informar `#16` (skill system) y `#32` (curaduría):

- **Context pointer** — referencia en contexto que nombra material fuera-de-contexto +
  codifica la condición para alcanzarlo. El *wording* del pointer (no su target) decide
  **cuándo** el agente lo alcanza y **qué tan confiablemente**. Un target must-have tras
  un pointer débilmente worded es un **variance bug**.
- **The two loads** — todo doc/pointer gasta uno de dos presupuestos: **context load**
  (costo en tokens/atención del material always-loaded en el window) vs **cognitive load**
  (costo para el humano de saber qué docs existen y cuándo alcanzarlos). El humano es el
  índice; cognitive load **no** es a minimizar — es el precio de la *human agency*.
- **Information hierarchy** — ladder por inmediatez: (1) in-file step, (2) in-file
  reference, (3) **disclosed reference** (pushed a archivo separado, detrás de un pointer,
  cargado solo cuando el pointer dispara).
- **Progressive disclosure** — el movimiento *down the ladder*; **no** es primariamente
  optimización de tokens, es **cómo se protege la jerarquía**. Test de branching: inline
  lo que toda branch necesita, push-behind-pointer lo que solo algunas branches alcanzan.
- **Co-location** — la definición, reglas y caveats de un concepto bajo **un heading**
  (no esparcidas). Test: *"should read like documentation written for the agent"*.
- **Sprawl** — el failure mode: un doc simplemente demasiado largo aunque cada línea sea
  única y viva. La atención se diluye. Cura: la ladder (disclose reference behind
  pointers, split por branch/sequence).

### Infraestructura de skills de referencia (recetas portables para `#16`)

| Mecanismo de Matt | Receta para Frida |
| --- | --- |
| **`invocation.md`** — user-invoked vs model-invoked | Formalizar la distinción en `#16`: user-invoked = `disable-model-invocation` + `allow_implicit_invocation: false` (solo el humano). Test: *"could the model usefully reach for this autonomously?"*. Una user-invoked puede invocar model-invoked, **nunca** otra user-invoked. |
| **Dependencies como `/skill`-style prose invocation** | No deep `../other-skill/FILE.md` cross-refs. Shared reference docs viven en la skill que los posee; otras los alcanzan **invocando la skill**. = patrón de composición limpio. |
| **5 buckets por madurez** (engineering/productivity/misc/in-progress/deprecated) | Organización de skills por madurez/propósito, con READMEs que agrupan en User-invoked / Model-invoked. |
| **Router pattern** (`ask-matt`) | Un skill router que mapea todas las skills user-reachable + flujos, **re-sincronizado** al añadir/renombrar/cambiar skills. Frida tiene el pipeline RPIV pero no este mapa explícito. |
| **`CONTEXT.md`** (ubiquitous language por repo) | Domain-modeling por repo con términos canónicos + "avoid" lists + relaciones + ambigüedades resueltas. Conecta con el skill `domain-modeling` existente. |
| **docs tree espeja skills + 4 secciones/página** | What it does / When to reach for it / Common questions / It's working if. Patrón de docs de skills. |
| **Cross-agent** (`agents/openai.yaml` + `.claude-plugin` + skills.sh) | Config por agente + distribución multi-canal. skills.sh es el instalador que Frida YA usa (`read_skills`). |

## Por qué NO es un porte

- **Frida ya usa estas skills** (mismo ecosistema skills.sh/GSD — 8 nombres idénticos).
  Un porte duplicaría lo existente.
- Las skills candidatas a adoptar (`wayfinder`, `ask-matt`, `triage`) son **adopciones
  selectivas vía skills.sh** (`read_skills(source="mattpocock/skills", name=..., full=true)`),
  no una extensión nueva.
- La **teoría de diseño** (`writing-for-agents`) alimenta `#16`/`#32` como referencia, no
  como código a portar.

**Estatus:** upstream canónico de parte del skill set de Frida + fuente de gaps + teoría
de diseño. El más cercano de toda la serie — por eso aporta los 3 pilares en vez de solo
"porte" o "no-porte".

## Gaps prioritarios para evaluar tras esta nota

1. **`wayfinder`** (decision tickets para esfuerzos grandes) — el gap más concreto y
   conexo con `#36` (kanban) + integración de issue tracker. Candidato a issue propio si
   se prioriza.
2. **Router `ask-matt`** — Frida tiene el pipeline RPIV pero no un mapa explícito
   "¿qué skill usar cuándo?". Candidato a skill/metadoc.
3. **`writing-for-agents` como referencia** — alimentar `#16` (skill system) y `#32`
   (curaduría) con la teoría de context pointers / two loads / information hierarchy.

## Referencias

- Repo: [`mattpocock/skills`](https://github.com/mattpocock/skills).
- skills.sh (instalador cross-agent que Frida ya usa): [`skills.sh/mattpocock/skills`](https://skills.sh/mattpocock/skills).
- Issues destino: **#16** (skill system — invocation, buckets, router) · **#32** (curaduría
  — teoría `writing-for-agents`) · **#36** (kanban — `wayfinder` decision tickets).
- Serie de research: `agent-os-standards-injection.md` · `bmad-loop-parity.md` ·
  `aidd-bmad-feasibility.md` · `graph-engineering-parity.md` · `sdlc-antigravity-parity.md`
  · `factory-missions-parity.md` · `adlc-boundary.md`.
- Contraste filosófico: ADR-0051 (consolidación `frida-workflow`) — el modelo "dueño del
  proceso" que Matt critica.
