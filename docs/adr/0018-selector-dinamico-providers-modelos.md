# ADR-0018 — Selector de modelos: refresh asíncrono + info rica (paridad TUI)

**Estado:** Aceptada · **Fecha:** 2025-07-29 · **Relaciona:** ADR-0017 (registry z.ai), ADR-0010 (agentDir propio)

## Contexto

Tras añadir Z.ai (ADR-0017) se revisó cómo el **TUI de pi** maneja proveedores y
modelos. El TUI descubre proveedores dinámicamente y refresca los catálogos **en
background** con degradación por proveedor, y muestra info rica por modelo. Frida, en
cambio, tiene un selector de modelos **estático** (un botón "Explorar" manual que sólo
cubre z.ai) y las filas del selector sólo muestran `name`.

La API del `ModelRuntime` del SDK **ya está disponible** en Frida. La exploración
(`scripts/explore-providers.mjs`, Fase 0) confirmó que `getProviders()` devuelve **39
proveedores** (zai, openai con 46 modelos, anthropic, groq, deepseek, xai, etc.).

## Decisión

### A — Lista explícita del registry (NO discovery dinámico de los 39)

**Decisión de producto:** el selector lista **sólo los proveedores del registry de
Frida** (lista explícita, ampliable editando el vsix), **no** los 39 built-ins de pi-ai.
Para añadir un proveedor nuevo, un desarrollador lo añade al registry y recompila.

El registry (`src/providers/api-key-providers.ts`, ADR-0017) ya es esa lista. Esto
simplifica vs el discovery dinámico:

- **Built-in de pi-ai** (zai, openai, anthropic…): añadirlo = **1 entrada** en
  `API_KEY_PROVIDERS` (`{id, displayName, secretKey, authMode}`). NO necesita
  `providers/<id>.ts` ni `registerProvider` (el built-in ya lo carga el SDK); sólo
  `setRuntimeApiKey(id, key)` con la key del SecretStorage.
- **Proveedor custom** (softtek-devengine): como hoy (entrada del registry +
  `providers/softtek-provider.ts` + `registerProvider` + hooks `X-Api-Key`/dump).

`zai` deja de necesitar su archivo `providers/z-ai-provider.ts` para el registro (sólo
lo conserva para `discoverZaiModels` / el override de exploración).

**Auth:** SecretStorage de VS Code (`frida.<provider>Key`) para **todos** los proveedores
de API key, inyectada vía `setRuntimeApiKey(id, key)` al arrancar. Consistencia con
DevEngine + aislamiento (la key no vive en texto plano en `~/.frida/auth.json`).

### B — Refresh asíncrono con snapshot (reemplaza el botón "Explorar" manual)

Hoy el botón "Explorar" hace `GET /models` **sólo para z.ai** y manualmente. Se unifica y
automatiza con la API del SDK:

```ts
// Al abrir el ModelPanel: render inmediato + refresh en background.
postModels(modelRuntime.getAvailableSnapshot(), { refreshing: true });
const result = await modelRuntime.refresh({ allowNetwork: true });  // GET /models por provider configurado
// result = { aborted, errors: Map<providerId, Error> }
postModels(modelRuntime.getAvailableSnapshot(), {
  refreshing: false,
  refreshedOk: result.errors.size === 0,
  errors: [...result.errors.keys()],   // "No se pudo refrescar X; catálogo cacheado."
});
```

- `refresh()` cubre **todos** los proveedores configurados del registry a la vez.
- **Degradación por proveedor** (timeout 15s + AbortController); nunca cuelga.
- El botón "Explorar" manual se rebautiza **"Refrescar"** (o se elimina; el refresh
  automático al abrir + el del SDK tras `setKey` cubren el caso).

### C — Información rica por modelo en el selector

Cada fila del selector pasa de mostrar sólo `name` a los metadatos que el objeto `Model`
del SDK ya trae:

```
glm-4.7 [zai] · 200K ctx · 131K out · ✓thinking · 🖼️input
```

Datos: `contextWindow`, `maxTokens`, `reasoning`, `input[]`. El `ModelOption` del webview
se amplía; el `ModelPanel` los pinta.

## API del ModelRuntime usada (todas disponibles en Frida)

| Método | Para | Sincronía |
| --- | --- | --- |
| `getAvailableSnapshot()` | B — catálogo cacheado (render inmediato) | sync |
| `refresh({allowNetwork})` → `{aborted, errors: Map}` | B — refrescar catálogos | async |
| `getError()` | B — errores de carga de models.json | sync |
| `Model.{contextWindow,maxTokens,reasoning,input}` | C — info por modelo | sync |
| `setRuntimeApiKey(id, key)` | A — auth de API key | async |

## Plan por fases

| Fase | Qué | Riesgo | Valor |
| --- | --- | --- | --- |
| **0** ✅ | Exploración `getProviders()`/`getProviderAuthStatus()` (`explore-providers.mjs`). Confirmó 39 built-ins + que `zai` aparece solo. | bajo | validación |
| **1** | **C — Info rica por modelo**: ampliar `ModelOption` + filas del `ModelPanel` con context/maxTokens/thinking/images. | bajo | medio |
| **2** | **B — Refresh asíncrono**: snapshot inmediato + `refresh()` en background con estado en el footer. Rebautizar/eliminar botón "Explorar". | medio | alto |
| **3** | **A — Simplificar añadir built-ins**: documentar + validar que 1 entrada del registry basta para un built-in (sin `providers/<id>.ts`). | bajo | mantenibilidad |

## Consecuencias

- **Positivas:** el refresh es universal con buena UX de degradación; el selector es
  informativo (context/thinking/imágenes); añadir un built-in es 1 entrada; alineación
  con el TUI en lo que sí aplica (refresh + info rica); la lista de proveedores sigue
  siendo **explícita y controlada** (decisión de producto).
- **Negativas:** NO se ofrece el catálogo de 39 built-ins al usuario final (decisión
  explícita: añadir un proveedor requiere editar el vsix); el refresh depende de los
  endpoints `/models` de cada proveedor (best-effort con degradación).
- **Riesgo mitigado:** el snapshot garantiza que el selector nunca quede vacío aunque
  `refresh` falle; DevEngine no se ve afectado (sigue en el registry como excepción con
  sus hooks); `zai` mantiene su exploración (`discoverZaiModels`) para novedades fuera del
  catálogo oficial.

## Fuera de alcance

- Discovery dinámico de los 39 built-ins en la UI (decisión de producto: lista
  explícita del registry).
- Búsqueda fuzzy + scope toggle (opcional, Fase 4, si la lista del registry crece).
- Resolver `provider/model` refs y `defaultModelPerProvider`.
