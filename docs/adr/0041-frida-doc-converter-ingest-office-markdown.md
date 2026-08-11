# Extensión `frida-doc-converter`: ingest Office↔markdown con *provenance* (sin Docker)

**Estado:** aceptado (#30; **bloqueada por `frida-knowledge-base`**).

## Contexto

El dolor central del análisis/diseño disperso son los documentos **Office** (Word, Excel, PowerPoint):
referencias débiles por nombre, y documentos que **incrustan** otros (OLE objects) — ilegibles para la
IA. Tras consolidar todo en una KB markdown (ADR-0040), hace falta un motor que **convierta esos
Office a markdown estructurado con *provenance*** (de qué doc/página/celda/slide viene cada
fragmento) para que las referencias sean **duras y rastreables**.

[`@blackbelt-technology/pi-dashboard-document-converter`](https://github.com/BlackBeltTechnology/pi-agent-dashboard)
lo resuelve, pero con un **motor Python en Docker** (pesado). Existe una alternativa ligera y pura-TS:
**`markitdown-ts`** (porte del MarkItDown de Microsoft) + **`mammoth`** (docx→HTML/markdown) — ingest
**sin Docker**.

## Decisión

**D1 — Extensión nativa `frida-doc-converter`: ingest Office (Word/Excel/PPT) → markdown con
*provenance*.** Usa `markitdown-ts`/`mammoth` (puro TS, **sin Docker**). Módulo:
`src/tools/frida-doc-converter/`.

**D2 — Bidireccional.** Ingest → markdown para la KB; y markdown → **DOCX/PDF** (templated) para que
los analistas **sigan recibiendo** sus artefactos Office. La KB es fuente de verdad; el Office es una
vista generada.

**D3 — *Provenance* embebido.** Cada fragmento markdown lleva cita de origen (archivo/página/celda/
slide) → las referencias de la KB son **duras y rastreables** hasta el documento original.

**D4 — Bloqueada por `frida-knowledge-base` (ADR-0040).** El converter **alimenta** la KB; no tiene
sentido sin el núcleo. Su output (markdown + *provenance*) entra vía `/wiki-ingest` de la KB.

**D5 — Sin Docker (diferenciador vs @blackbelt).** `markitdown-ts`/`mammoth` puro TS → ligero y
portable. Si en el futuro se necesita potencia (OOXML raro, diagramas complejos), se añade el motor
Docker como **opt-in**, no por defecto.

**D6 — Cero conflicto.** Nueva superficie (tools de conversión). Ortogonal al núcleo de la KB.

## Alternativas consideradas

- **A — `@blackbelt` document-converter (Docker).** Más potente (diagramas, OOXML completo) pero
  **pesado**; queda como opt-in futuro, no por defecto.
- **B — `pandoc` (`node-pandoc`).** Requiere el binario `pandoc` instalado (dependencia externa);
  manejo limitado de Excel/PPT y de *provenance*.
- **C — Que el agente lea los Office a mano.** No escala; pierde estructura tabular, slides y
  *provenance*.

## Consecuencias

**Positivas**

- Resuelve el dolor **Office disperso** → markdown estructurado con *provenance* → referencias duras.
- **Sin Docker** (ligero, portable, fácil de instalar).
- **Bidireccional**: los analistas siguen trabajando en Office; la IA lee markdown.

**Negativas**

- Adaptación de `markitdown-ts`/`mammoth`; manejo de objetos incrustados (OLE) y tablas complejas.
- Calidad de conversión de **PPT/diagramas** (puede requerir visión multimodal para mockups).
- **Dependencia bloqueante**: la KB (#29/ADR-0040) debe existir primero.

## Referencias

- Issue **#30**.
- **Dependencia bloqueante: `frida-knowledge-base` (ADR-0040)**.
- Upstream de referencia: `@blackbelt-technology/pi-dashboard-document-converter` (motor Docker).
- Librerías base: `markitdown-ts` (porte de MS MarkItDown), `mammoth` (docx).
