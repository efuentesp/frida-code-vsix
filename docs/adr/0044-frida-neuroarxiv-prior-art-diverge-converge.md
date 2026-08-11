# `frida-neuroarxiv`: prior-art vía workflow diverge/converge aislado

**Estado:** aceptado (#33). No bloqueado (factible hoy sobre `frida-extensible-workflows`).

## Contexto

El skill [`neuroarxiv`](https://github.com/UditAkhourii/neuroarxiv) (UditAkhourii, MIT, 284★ GitHub)
hace **prior-art research** antes de construir arquitectura no-trivial: categoriza el problema en
taxonomía arXiv → **fetch real** contra `export.arxiv.org` (HTTP, no LLM) → **diverge** (un subagente
aislado por paper, en paralelo) → score/cluster → **converge en UNA ruta recomendada** con citas reales.
Su tesis —"los vibecoders pierden horas no por falta de skill sino porque construyen antes de revisar
si la parte difícil ya fue resuelta y publicada"— es metodológicamente sólida para arquitectura no
trivial.

Identificado en el video *"This Claude Code Skill make Building 10x Faster"* (AI LABS,
youtube `b9k-AE4v5yI`) como una de las 2 skills que evitan que el agente reconstruya lo que ya existe.

El patrón **diverge-aislado / converge-en-una-ruta** es novedoso y **no está en ninguna extensión
planeada** de Frida (no entre los 5 patrones de #19). El cop-out *"aquí hay 3 opciones, tú decide"* está
explícitamente prohibido: neuroarxiv se compromete a una recomendación.

## Decisión

**D1 — Workflow sobre `frida-extensible-workflows`, no extensión nativa.** Cero código nativo. El loop
mapea 1:1 sobre el runtime: `parallel(papers.map(p => agent(readOne, {problem, p})))` →
`agent(converge, reads)`.

**D2 — Las 5 fases, mapeadas al runtime:**

- **Fase 0 — Categorize** (agent): mapear el problema a 3-5 categorías arXiv + 3-6 términos técnicos
  concretos.
- **Fase 1 — Fetch** (web_fetch del agente principal): query real contra
  `export.arxiv.org/api/query?...`. Feed Atom XML = ground truth. Nunca inventar un paper/id/detalle.
  Cortesía arXiv: una categoría a la vez con ~3s entre llamadas.
- **Fase 2 — Diverge** (`parallel()` de `agent()` aislados): un subagente por paper. Cada uno recibe
  **sólo** un paper (título/abstract/autores/año) + el problema. Extrae
  `{approach, borrow, limitation, relevanceNote}`. **Los subagentes no necesitan web** — leen abstracts
  pre-fetched → **no choca con el gap "subagentes sin web tools" de #19.**
- **Fase 3 — Score + Cluster** (agent): score 0-10 en relevance/practicality/rigor (practicality pesa
  más — el punto es construir, no survey). Clústeres por **ángulo arquitectónico** (no por keyword/paper).
- **Fase 4 — Converge** (agent): elegir **UN** clúster (mejor relevance+practicality, no el más
  novedoso/citado), sintetizar plan implementable + citas (id+title+url+role) + first step +
  load-bearing risk + **avoid-list de TODOS los papers** (no sólo del ganador).

**D3 — Invariante de aislamiento.** La "isolation" es que un subagente **no vea otros papers**, no sobre
web. Se logra naturalmente con el sandbox de contexto aislado de cada `agent()`. Si una lectura menciona
"comparado con los otros papers aquí" → el aislamiento se rompió → descartar y re-correr esa lectura
sola (anti-pattern *cross-contaminated reads*).

**D4 — Converge en UNA ruta, no shortlist.** Anti-pattern explícito: *"shortlist-as-cop-out"*. La
recomendación debe ser comprometida. Los runner-ups se nombran con **una línea de trade-off real** c/u
(no un dismissal), para que el builder pueda cambiar de ruta después sabiendo por qué.

**D5 — Pre-flight gate (obligatorio).** El workflow es costoso (N+4 agentes, típicamente 12-20 papers).
Abortar si: (1) no hay mecanismo técnico real que investigar (CRUD/glue no califica); (2) el usuario no
compromete esfuerzo real (one-off script no califica); (3) el enfoque ya está cerrado (ya nombró
algoritmo/paper/library). Invocación explícita `/neuroarxiv` o "check arXiv prior art" → skip del gate.

**D6 — CLI TS original descartado.** Usa `@anthropic-ai/claude-agent-sdk` (vendor-locked a Anthropic).
Frida prefiere el workflow determinista del runtime, que es provider-agnóstico.

**D7 — Cero conflicto.** No es nativo → no requiere lifecycle hooks ni nueva infra. Reutiliza
`frida-extensible-workflows` + `frida-subagents`. Puede integrarse al catálogo de **#19** como **6º
patrón** (research-workflow diverge/converge) o como workflow standalone. Ortogonal a **#34
advise-project-approach** (eje técnico/académico vs producto/ecosistema).

## Alternativas consideradas

- **A — CLI TS original (Anthropic SDK).** Descartado: vendor-locked; Frida es provider-agnóstico y ya
  tiene el runtime de workflows.
- **B — Extensión nativa.** Descartado: no necesita código nativo; es un workflow compuesto de
  `agent()`/`parallel()` ya soportados por el runtime.
- **C — Skill de prompt puro (el SKILL.md original con WebFetch + Agent/Task).** Funciona en Claude Code
  pero Frida prefiere el workflow determinista del runtime (mejor para reanudación, telemetría, y
  reusar el fan-out paralelo).

## Consecuencias

**Positivas**

- Patrón diverge/converge aislado = demostración valiosa de `frida-extensible-workflows`.
- Prior-art grounding para arquitectura no-trivial, con citas reales y avoid-list.
- Feasible hoy, sin nueva infra.

**Negativas**

- Costoso: N+4 agentes por run. El pre-flight gate (D5) es obligatorio para no quemarlo en problemas
  triviales.

## Referencias

- Issue **#33**.
- Origen: `neuroarxiv` (UditAkhourii, MIT) — <https://github.com/UditAkhourii/neuroarxiv> · 284★.
- Video fuente: *"This Claude Code Skill make Building 10x Faster"* (AI LABS, youtube `b9k-AE4v5yI`).
- Complementario de: **#34 advise-project-approach** (ADR-0045) — técnico vs producto.
- Runtime base: `frida-extensible-workflows` · `frida-subagents`. Puede ser 6º patrón de **#19**.
