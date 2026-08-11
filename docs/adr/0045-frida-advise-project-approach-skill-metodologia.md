# `frida-advise-project-approach`: skill de metodología de estrategia de proyecto

**Estado:** aceptado (#34). **Bloqueado por #16** (sistema de skills).

## Contexto

El skill [`advise-project-approach`](https://github.com/AaravKashyap12/advise-project-approach)
(AaravKashyap12, MIT, 147★ GitHub) es una skill **pura de prompt/metodología** (cero código) para
research de estrategia de proyecto: intake → inspecciona repo existente → busca comparables reales
(proyectos OS, SaaS, herramientas) → tradeoffs → análisis de costo operativo → recomendación.

Identificado en el video *"This Claude Code Skill make Building 10x Faster"* (AI LABS,
youtube `b9k-AE4v5yI`) como una de las 2 skills que evitan que el agente reconstruya lo que ya existe.

**Valor honesto:** el agente principal de Frida **ya puede** investigar comparables ad hoc
(web_search + web_fetch + leer repo). Esta skill añade **estructura y disciplina**, no capacidad nueva.
Eso es la naturaleza de un skill — codifica una mejor-práctica. Por eso es **prioridad baja y bloqueada
por #16** (Frida no tiene dónde hospedar skills procedurales todavía).

## Decisión

**D1 — Skill en `#16` (sistema de skills), no extensión nativa.** Cero código nativo; es
prompt/metodología pura.

**D2 — Corre en el agente principal** (web_search / web_fetch / agent_browser / GitHub search).
Investigación **secuencial** — **no necesita subagentes con web** (sin gap de infra, a diferencia del
`deep-research` de #19 que era needs-infra).

**D3 — Tres modos operativos**, seleccionados por señales:

- **Pre-build strategy** — sin repo, o decidiendo cómo construir. Focus: requirements, comparables,
  stack, arquitectura, riesgos, path de implementación.
- **Mid-build course correction** — repo/parcial existe. Inspecciona código, compara con objetivo +
  referencias externas, recomienda qué conservar/cambiar/deferir.
- **Post-build review** — proyecto completo. Revisa arquitectura, calidad, mantenibilidad, deploy
  readiness, seguridad, gaps vs. proyectos maduros.

Regla: sin repo/código → pre-build; "estoy construyendo..." → mid-build; "finished/deployed/ready" →
post-build.

**D4 — Read-only por defecto.** Inspección de repo **no autoriza** instalar dependencias ni ejecutar
tests/builds/linters/audits/scripts. Pide permiso antes. No interpretes "review this repo" como
permiso para correr su código.

**D5 — Disciplina anti-alucinación (el núcleo de la skill):**

- **Require receipts:** recomendación sustantiva requiere 2 comparables + docs/pricing primarias.
  Decir qué se inspeccionó, qué soporta cada fuente, sus límites, y fecha observada.
- **No outsource to popularity:** nunca seleccionar/copiar un stack porque tiene más stars/adopción.
  Stars ≠ fit test. Si el usuario pide ese atajo, explicar por qué no lo es.
- **Separar `what transfers` de `what should not be copied`:** un comparable maduro con infra pesada
  puede reflejar su escala/equipo/historia, no tus necesidades reales.
- **Freshness rules:** fecha observada para claims time-sensitive (precios, quotas, "active/maintained").
  No "free/cheap" sin nombrar límites. Distinguir dev cost / launch cost / steady-state cost.
- **Complete the decision:** toda recomendación incluye constraint fit + ≥1 alternativa + tradeoffs +
  cuándo se vuelve incorrecta + next actions ordenadas.

**D6 — Análisis de costo operativo en 3 buckets** (cuando pricing es material): prototype cost (cercano
a free con uso mínima) / launch cost (qué cambia con usuarios reales) / growth cost (qué escala más
rápido o crea lock-in). Sin precisión falsa — scenario-based.

**D7 — Hard gate: bloqueado por #16.** Frida no tiene sistema de skills todavía. Esta skill sólo se
inicia tras que #16 esté implementado y validado e2e. Hasta entonces, decisión documentada.

**D8 — Cero conflicto.** No es nativo (no requiere código). Ortogonal a #33 neuroarxiv (eje
producto/ecosistema vs técnico/académico). Distinto de #19 deep-research (advise es main-agent
secuencial sin gap de infra).

## Alternativas consideradas

- **A — Extensión nativa.** Descartado: no necesita código; es prompt/metodología pura.
- **B — Workflow sobre extensible-workflows.** Descartado: no es fan-out paralelo; es investigación
  secuencial del agente principal. Un workflow aislaría contexto innecesariamente.
- **C — Fold en #19 (capa de patrones).** Parcialmente viable, pero su naturaleza de skill procedural
  encaja mejor en el sistema de skills de #16; #19 es para workflows compuestos de `agent()`/`parallel()`.

## Consecuencias

**Positivas**

- Metodología de decisión valiosa: anti-bias-popularidad, cost-reality, tradeoff discipline, output
  contracts. Reduce recomendaciones genéricas y claims sin evidencia.
- Feasible en capacidad hoy (web tools del agente principal).

**Negativas**

- Aporta **disciplina, no capacidad nueva** (el agente ya investiga ad hoc). Prioridad baja.
- Bloqueado por #16 (sistema de skills inexistente).

## Referencias

- Issue **#34**.
- Origen: `advise-project-approach` (AaravKashyap12, MIT) — <https://github.com/AaravKashyap12/advise-project-approach> · 147★.
- Video fuente: *"This Claude Code Skill make Building 10x Faster"* (AI LABS, youtube `b9k-AE4v5yI`).
- **Bloqueado por: `#16`** (sistema de plugins/skills).
- Complementario de: **#33 neuroarxiv** (ADR-0044) — producto vs técnico.
