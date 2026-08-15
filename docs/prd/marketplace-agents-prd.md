# PRD — AgentHub (nombre tentativo)

> **Marketplace/registry curado de extensiones para agentes de código**, multi-harness,
> controlado por la empresa, con integración nativa en Frida.

| Campo | Valor |
| --- | --- |
| Estado | Borrador v1 (para revisión) |
| Proyecto | Independiente de frida-code (repo propio), co-diseñado con el issue frida-code-vsix#16 |
| Dueño | Empresa (equipo por definir) |
| Fecha | 2026-08-14 |
| Nombre tentativo | **AgentHub** — candidatos: agenthub, agentshelf, kitforge |

---

## 1. Resumen ejecutivo

Un **sitio + API + CLI + registry** donde la empresa publica, curada y versionada, una
catálogo de extensiones para agentes de código: **skills, servidores MCP, workflows,
templates, agentes, comandos, hooks y plugins** (paquetes que combinan varios de los
anteriores para un contexto específico: un rol de la organización, una tarea o un tipo
de proyecto).

Diferenciadores frente a skills.sh / skillsmp / aitmpl:

1. **Curaduría corporativa**: solo la empresa publica. Todo item pasa por revisión y
   firma. Nada de self-service comunitario sin control.
2. **Plugins orientados a contexto**: primera clase del catálogo, con metadatos de
   audiencia (rol/tarea/proyecto/stack) que alimentan la búsqueda y el descubrimiento
   ("quiero el pack del rol QA", "algo para code review en este proyecto").
3. **Multi-harness real**: cada item declara compatibilidad (Frida, Claude Code,
   OpenCode, GitHub Copilot, Cursor, Codex…) y se instala con el formato correcto para
   cada destino.
4. **Descubrimiento desde dentro del agente**: búsqueda e instalación sin salir de la
   herramienta (panel web + herramienta de agente en Frida; MCP/CLI para los demás).

**No se construye desde cero**: la base es open source MIT (ver §9).

---

## 2. Problema y oportunidad

### Problema

- Las capacidades de un agente (skills, MCPs, workflows) viven dispersas en repos de
  GitHub, npm y documentos internos. No hay forma estándar de **encontrarlas,
  versionarlas, confiar en ellas ni instalarlas**.
- Los marketplaces existentes (skills.sh, skillsmp, claudemarketplaces, aitmpl) son
  abiertos/comunitarios, Claude-centric en su mayoría, sin curaduría corporativa ni
  bundles orientados a contextos organizacionales.
- Cada desarrollador arma su propio kit → inconsistencia, riesgo (instalar código de
  terceros sin revisión) y desperdicio.

### Oportunidad

- Un punto de control y distribución que convierte el conocimiento de la organización
  (metodologías, tooling, estándares) en **assets reutilizables instalables**.
- Alineado con los pilares de Frida (auditoría, disuasivo): incluso la instalación de
  extensiones queda gobernada y auditada.

---

## 3. Objetivos y no objetivos

### Objetivos

1. Catálogo central, versionado y firmado de recursos para agentes de código.
2. Publicación **exclusivamente controlada por la empresa** (flujo de curación).
3. Búsqueda e instalación **desde dentro de Frida** (panel webview + herramienta del
   agente), sin salir del flujo de trabajo.
4. Soportar el tipo **plugin bundle**: conjunto empaquetado de skills/MCPs/workflows/
   commands/hooks orientado a un contexto (rol, tarea, proyecto).
5. Compatibilidad multi-harness: mismo item instalable en Frida, Claude Code, OpenCode,
   GitHub Copilot y otros, cada uno con su formato destino.
6. API pública documentada y CLI instalable vía npx.

### No objetivos (v1)

- ❌ Publicación abierta comunitaria / self-service de terceros.
- ❌ Monetización / cobro por item.
- ❌ Ejecución/remotas de código en el registry (solo distribución de manifiestos y
  artefactos; el código vive en git/npm del artifacts store).
- ❌ Marketplace de modelos/proveedores LLM.
- ❌ Ratings/comentarios públicos (señales de uso internas sí, ver §7).

---

## 4. Usuarios y roles

| Rol | Quién | Necesita |
| --- | --- | --- |
| **Curador/Publisher** (empresa) | Equipo de plataforma/tools | Publicar, versionar, firmar, deprecar; ver métricas; cola de revisión |
| **Autor interno** | Equipos que contribuyen assets | Proponer items al curador (intake), checklist de publicación |
| **Usuario final** | Desarrolladores con Frida/otros harnesses | Buscar por contexto, ver qué instala, confiar, instalar en 1 clic/comando |
| **Agente (no humano)** | Frida u otro harness actuando por el usuario | API de búsqueda + instalación con aprobación humana |

---

## 5. Catálogo — tipos de recurso

| Tipo | Descripción | Formato de origen | Instalación (ejemplo) |
| --- | --- | --- | --- |
| `skill` | Conocimiento procedural reutilizable | `SKILL.md` + assets (spec Agent Skills) | copia a dir de skills del harness / pi-package |
| `mcp` | Servidor MCP | `.mcp.json` (formato compartido estándar) | merge en config MCP del harness |
| `workflow` | Workflow determinista multi-agente | script JS (formato frida-extensible-workflows) | `.frida/workflows/` o plugin namespace |
| `plugin` | **Bundle** de N recursos + manifiesto | `.frida-plugin/plugin.json` (o genérico §6) | instala todos sus componentes |
| `agent` | Definición de subagente (system prompt, tools) | markdown/yaml por harness | dir de agents |
| `command` | Slash command | markdown/yaml | dir de commands |
| `hook` | Hook declarativo de eventos | `hooks.json` | merge en config de hooks |
| `template` | Plantilla de proyecto/scaffold con assets de agente | repo/dir de template | `create` / clonar |

> **`plugin` es la estrella**: empaqueta cualquier combinación de los demás tipos y
> declara el **contexto** al que atiende. Los tipos sueltos siguen existiendo para
> composición fina.

---

## 6. Modelo de datos

### 6.1 Manifiesto de plugin (`.agenthub/plugin.json`, tentativo)

```jsonc
{
  "schema": "agenthub.plugin/1",
  "id": "acme.qa-lead-pack",           // namespace por organización
  "name": "QA Lead Pack",
  "version": "1.2.0",                  // SemVer, inmutable una vez publicado
  "publisher": "acme-platform",
  "description": "Kit completo para el rol de QA lead: estrategia de pruebas, regression planning, reporting.",
  "license": "MIT",
  "repo": "https://github.com/acme/qa-lead-pack",
  "context": {                          // ← descubre por rol/tarea/proyecto
    "roles": ["qa-lead", "qa-engineer"],
    "tasks": ["test-architecture", "regression-planning", "test-reporting"],
    "projectTypes": ["web-app", "api"],
    "stack": ["vitest", "playwright"],
    "tags": ["testing", "quality"]
  },
  "compatibility": {
    "frida": ">=0.19.0",
    "claude-code": ">=1.0.60",
    "opencode": "*",
    "github-copilot": "*"
  },
  "permissions": {                      // ← consentimiento en instalación
    "tools": ["read", "bash"],
    "network": ["registry.npmjs.org", "*.playwright.dev"],
    "filesystem": ["workdir", "test-results/"]
  },
  "includes": {
    "skills": ["skills/test-architecture", "skills/regression-planning"],
    "mcp": ["mcp/playwright.json"],
    "workflows": ["workflows/audit-suite.js"],
    "commands": ["commands/qa-report.md"],
    "hooks": ["hooks/hooks.json"]
  },
  "entrypoints": { "frida": "pi-package" } // formato destino por harness
}
```

### 6.2 Registro (entrada del catálogo, derivado + señales)

```jsonc
{
  "id": "acme.qa-lead-pack",
  "type": "plugin",
  "latest": "1.2.0",
  "versions": { "1.2.0": { "signature": "…", "publishedAt": "…", "reviewedBy": "…" } },
  "verified": true,                    // pasó curaduría + firma
  "signals": { "installs30d": 214, "installErrors": 0 },
  "source": { "kind": "git", "url": "…", "commit": "…" } // artifact provenance
}
```

Reglas: versiones **inmutables**; `deprecated: true` con sucesor sugerido; ids con
namespace `org.name`.

---

## 7. Publicación controlada por la empresa

```text
autor interno → [intake] propuesta (form/PR a repo interno)
                    │
                    ▼
        [CI] checks automáticos:
          · schema del manifiesto válido
          · licencias de dependencias
          · secret-scanning / patrones maliciosos (estático)
          · extracción y validación de permissions
          · build reproducible del paquete
                    │
                    ▼
        [curador] revisión humana (checklist: seguridad, calidad,
          redundancia con catálogo, audiencia/contexto correcto)
                    │
                    ▼
        firma (sigstore/cosign) → publish al registry (DB + CDN)
                    │
                    ▼
        deprecación / unpublish (con ventana de aviso a consumidores)
```

- **Identidad verificada**: publishers autenticados con SSO corporativo (patrón
  OIDC del registry oficial de MCP).
- **Verificación en instalación**: el CLI/panel valida firma y checksum antes de
  escribir en disco; si falla, instalación abortada y reportada.
- **Telemetría opt-in** de instalaciones/errores para métricas de curador.

---

## 8. Arquitectura

```text
┌──────────────────────── AgentHub (proyecto independiente) ────────────────────────┐
│                                                                                   │
│  ┌─ Web (Astro) ──┐  ┌─ API (Workers) ─┐  ┌─ Registry DB ─┐  ┌─ Intake/CI ─┐    │
│  │ catálogo,       │  │ /v1/search      │  │ items,        │  │ checks +     │    │
│  │ fichas, docs    │  │ /v1/items/:id   │  │ versiones,    │  │ firma +      │    │
│  │ (read-only)     │  │ /v1/telemetry   │  │ firmas        │  │ publish      │    │
│  └─────────────────┘  └─────────────────┘  └───────────────┘  └──────────────┘    │
│                              ▲                                                    │
└──────────────────────────────┼────────────────────────────────────────────────────┘
                               │ API pública (JSON, versionada)
        ┌──────────────────────┼──────────────────────────┐
        │                      │                          │
   ┌────┴─────┐         ┌──────┴──────┐          ┌────────┴────────┐
   │  Frida   │         │ CLI (npx)   │          │ MCP search      │
   │ panel +  │         │ multi-agente│          │ server (opt.)   │
   │ agente   │         │ fork skills │          │ para cualquier  │
   └──────────┘         └─────────────┘          │ harness         │
                                                   └─────────────────┘
```

- **API pública** es el contrato central: cualquier harness puede integrarse.
- **CLI** (fork de `vercel-labs/skills`, MIT): `npx agenthub add acme.qa-lead-pack
  --agent frida|claude-code|opencode|copilot|…`, con adaptador de destino por harness.
- **MCP search server** (fase posterior): expone búsqueda/instalación vía MCP para
  harnesses sin integración nativa.
- Los artefactos (contenido real) viven en **git del autor / artifact store**; el
  registry distribuye manifiestos firmados + referencias.

---

## 9. Base open source (no construir desde cero)

| Base | Uso | Licencia |
| --- | --- | --- |
| [`davila7/claude-code-templates`](https://github.com/davila7/claude-code-templates) | Fork del monorepo: web (Astro+Tailwind), API (Cloudflare Workers + crons), DB migrations, CLI. Catálogo multi-tipo ya resuelto. | MIT |
| [`vercel-labs/skills`](https://github.com/vercel-labs/skills) | Base del CLI instalador: 77 harnesses, resolución git/npm/local, repos privados. Se añade destino `frida`. | MIT |
| [`modelcontextprotocol/registry`](https://github.com/modelcontextprotocol/registry) | **Patrón** (no fork): publish con identidad verificada, API versionada, inmutabilidad. Licencia custom. | referencia |

**Adaptaciones obligatorias sobre davila7**: rebrand multi-harness (no "Claude"-
centric), quitar métricas/branding del original, añadir tipos `workflow` y `plugin`,
gateway de curación (§7), firma de versiones.

**Riesgo**: forks de proyectos unipersonales activos → nuestra rama diverge. Mitigación:
tratar el upstream como punto de partida (no sincronizar perpetuamente), extraer patrones
y evolucionar propio.

---

## 10. Integración con Frida (issue #16 — lado frida)

> Se implementa en frida-code como fases propias del issue #16. AgentHub solo garantiza
> la API y el formato `pi-package + .frida-plugin/` (decisión "híbrida" ya tomada en el
> issue).

### 10.1 Alternativas consideradas para el lado frida

| | A. API + panel nativo | B. Envolver el CLI | C. MCP server |
| --- | --- | --- | --- |
| Qué | Frida consume la API de AgentHub desde el webview y el agente; adaptadores de instalación propios por tipo (pi-package → `pi install`, MCP → `.mcp.json`, workflows → `.frida/workflows/`) | Frida exec `npx agenthub …` como hace git-sync con `pi` | AgentHub se expone como MCP; búsqueda vía frida-mcp-adapter |
| Pros | UX integrada (panel con búsqueda/filtros por rol), instalación gobernada por el gate de aprobaciones de frida, auditada | Menos código propio | Casi cero código en frida; sirve a todos los harnesses |
| Contras | Más código en frida | UX lenta, menos control del approval flow | Instalación no es MCP-native; requiere igualmente A o B |

**Recomendación: A (nativo) + C (fase posterior para otros harnesses)**, con B como
respaldo para scripting/CI.

### 10.2 UX en Frida

- **Panel "Marketplace"** (webview): buscador con filtros (tipo, rol, tarea, stack,
  harness), ficha con permissions y señales, botón Instalar → **approval gate** (mismo
  patrón del trust store de frida-git-sync: fuentes nuevas requieren aprobación
  explícita; "recordar" opcional).
- **Herramienta de agente** `marketplace` (search/get/install): el usuario puede pedir
  en lenguaje natural *"busca un skill para test architecture"* y el agente busca en el
  catálogo; **toda instalación pasa por aprobación humana** y queda en el log de
  auditoría.
- **Slash commands**: `/marketplace [query]`, `/plugin install <id>`, `/plugin remove <id>`.
- Instalación de plugin = `pi install` del pi-package (skills/extensions/prompts) +
  materialización de `workflows/`, `hooks/`, `.mcp.json` con **namespacing**
  `/<plugin>:<recurso>` y registro para desinstalación limpia.

---

## 11. Seguridad y confianza

1. **Permisos declarados** en el manifiesto (herramientas, red, filesystem) → mostrados
   en el consentimiento de instalación; los hooks se integran al permission-system de
   frida.
2. **Firmas** por versión (sigstore/cosign) + checksums verificados en instalación.
3. **Checks automáticos** en publish: secret-scanning, licencias, patrones maliciosos
   estáticos, builds reproducibles.
4. **Revisión humana** obligatoria (solo curadores de la empresa).
5. **Inmutabilidad** de versiones publicadas; deprecación con aviso, nunca reescritura.
6. **Auditoría**: cada instalación/instalación fallida se registra (quién, qué versión,
   desde qué máquina/harness) — pilar de Frida extendido al ecosistema.
7. Superficie de ataque residual: los items ejecutan código en la máquina del
   desarrollador (skills=markdown de bajo riesgo; workflows/hooks/extensions=código) →
   el disuasivo es la curación + auditoría + permisos, no un sandbox (coherente con la
   postura de seguridad de frida; sandboxing real es issue aparte #35).

---

## 12. Roadmap

| Fase | Alcance | Criterio de éxito |
| --- | --- | --- |
| **F0 — Fundaciones** (2-3 sem) | Fork davila7 rebrandeado; manifiesto `agenthub.plugin/1`; tipos `workflow`+`plugin`; DB schema extendido; CI de checks básicos | Catálogo web despliega con 10 items internos reales; schema congelado v1 |
| **F1 — MVP búsqueda+instalación** (3-4 sem) | API `/v1/search` + `/v1/items`; CLI fork con destino frida (skills+mcp); **panel Marketplace en Frida** con approval gate; firma básica | Dev busca "playwright" desde Frida, instala, usa el skill; instalación auditada |
| **F2 — Plugins completos + curaduría** (4-6 sem) | Plugin bundles con workflows/hooks/commands; gateway de publicación con review humano + checklist; telemetría; deprecación | Publicar el primer pack por rol (p. ej. QA Lead) y adoptarlo en 2 equipos |
| **F3 — Multi-harness + contexto** (continuo) | Destinos claude-code/opencode/copilot en CLI; MCP search server; búsqueda por contexto enriquecida (recomendaciones por repo detectado); métricas de curador | Item instalable en ≥3 harnesses; 5+ packs por rol publicados |

---

## 13. Métricas

- **Adopción**: instalaciones activas 30d, % devs de la org con ≥1 pack, packs por rol
  cubiertos.
- **Calidad del catálogo**: tasa de error de instalación, tiempo de revisión (intake→
  publish), items deprecados vs activos.
- **Valor**: tiempo de onboarding de un dev nuevo al rol (objetivo: −50% con pack del
  rol), reutilización (instalaciones por item).
- **Seguridad**: intentos de instalación con firma inválida (debe ser 0 visible),
  incidentes.

---

## 14. Riesgos y mitigaciones

| Riesgo | Impacto | Mitigación |
| --- | --- | --- |
| Catálogo frío (nadie publica) | Adopción muere | F2 arranca con packs por rol creados por el equipo plataforma; meta mínimo 10 items F0 |
| Fork de davila7 diverge del upstream | Mantenimiento | Tratar como punto de partida, extraer patrones, evolucionar propio |
| Formato de plugin frida aún en diseño (#16) | Integración retrasada | Co-diseñar el manifiesto (§6) con el ADR de #16; el schema es extensible por harness |
| Skills/MD son seguros, pero workflows/hooks son código | Malware interno | Checks estáticos + review + permisos + auditoría (§11) |
| "Multi-harness" real es costoso (formatos distintos) | Alcance crece | Fase 3: empezar con frida + claude-code (formatos conocidos), sumar resto por demanda |

---

## 15. Decisiones abiertas

1. **Nombre** del producto (AgentHub tentativo) y dominio.
2. **Artifact store**: ¿git de cada autor (referencias firmadas) vs artifact store
   propio (tarballs firmados)? (Recomendación inicial: git + checksums; store propio si
   crece).
3. **Auth de la API pública**: ¿token por harness/usuario o solo lectura abierta dentro
   del VPN corporativo?
4. **Schema de permissions**: ¿nivel de detalle del ejemplo §6.1 o más simple v1
   (`tools`, `network: boolean`, `filesystem: [workdir]`)?
5. **Relación con pi.dev/packages**: los pi-packages ya se instalan vía `pi install`;
   AgentHub los referencia (`entrypoints.frida: "pi-package"`) sin duplicar npm —
   confirmar que la API de pi.dev es suficiente para metadatos o si cacheamos.
6. Hosting (Cloudflare vs interno) y presupuesto.

---

## 16. Referencias

- Issue frida-code-vsix [#16](https://github.com/efuentesp/frida-code-vsix/issues/16)
  (sistema de plugins, decisión híbrida pi + capa Claude Code).
- Sitios de referencia: skills.sh (Vercel, `npx skills`), skillsmp.com,
  claudemarketplaces.com, aitmpl.com.
- Open source: davila7/claude-code-templates (MIT), vercel-labs/skills (MIT),
  modelcontextprotocol/registry (patrón de publish verificado).
- Internos: `docs/roadmap-extensiones.md` (P2/P3 dependen de #16), frida-git-sync
  packages.ts (patrón trust store + aprobación).
