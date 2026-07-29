# ADR-0019 — Resolución del contextWindow del modelo DevEngine (override > gateway > catálogo)

**Estado:** Aceptada · **Fecha:** 2025-07-29 · **Relaciona:** ADR-0009 (bug reasoning DevEngine), ADR-0017 (registry)

## Contexto

DevEngine expone `gpt-5.4-mini` como alias detrás de su gateway, pero **no** provee
fiablemente su ventana de contexto. Frida lo **hardcodeaba** en `300000`
(`buildSofttekProviderConfig` + `frida.devengine.contextWindow`), un valor conservador
elegido por los `500` del gateway con historial grande (ADR-0009).

El SDK pi-ai **ya conoce** `gpt-5.4-mini`: está en **5 catálogos built-in** con
`contextWindow=400000` (azure-openai-responses, github-copilot, openai, opencode) —
sólo openai-codex dice `272000` (contexto de codificación, no el general). El TUI obtiene
el contextWindow **del catálogo** (dato estático bundleado), no de una consulta en vivo.

## Decisión

Resolver el `contextWindow` (y los metadatos) del modelo DevEngine por **prioridad**,
dejando de hardcodear:

```
1. OVERRIDE   frida.devengine.contextWindow  (si el usuario lo pone ≠ null)  ← control total
2. GATEWAY    GET /models DevEngine → context_window                        ← límite real del gateway
3. CATÁLOGO   gpt-5.4-mini en azure/openai de pi-ai → 400000                ← modelo nativo
4. DEFAULT    300000                                                         ← último recurso
```

- **Override:** `frida.devengine.contextWindow` ahora es **nullable** (default `null`).
  Si el usuario lo pone, **siempre gana** (control manual sobre el auto-detect).
- **Gateway:** `fetchDevengineContextWindow(baseUrl, key, modelId)` hace `GET /models`
  con `X-Api-Key` (reutiliza el patrón de `diagnoseGateway`), lee `context_window`/
  `context_length` del modelo. Best-effort (timeout 10s); si DevEngine no lo expone o
  falla, fallback al catálogo. **Sólo se ejecuta si DevEngine va a ser el modelo usado
  en la sesión** (`willUseDevengine`: es el activo, o el fallback si el activo no está
  autenticado) → no se llama al gateway cuando el usuario usa z.ai/Copilot pero tiene
  la key de DevEngine guardada.
- **Catálogo:** `lookupCanonicalModelMeta(mr, modelId)` busca en `azure-openai-responses`
  → `openai` → `github-copilot` → `opencode` (prioriza Azure porque DevEngine enruta a
  Azure; excluye `openai-codex` por su contexto de codificación 272000). Devuelve
  `contextWindow`/`maxTokens`/`reasoning`/`input`/`thinkingLevelMap` del modelo nativo.
- **Default:** 300000 (conservador) — sólo si nada de lo anterior resuelve (no aplica
  hoy: el catálogo siempre tiene gpt-5.4-mini).

**Metadatos canónicos:** `reasoning`, `input`, `thinkingLevelMap`, `maxTokens` vienen del
catálogo (modelo nativo), inyectados vía `buildSofttekProviderConfig({meta})`. El
`compat` de DevEngine (`requiresThinkingAsText`, `requiresAssistantAfterToolResult`,
`supportsReasoningEffort`) **se conserva intacto** — es específico del bug del gateway
(ADR-0009) y NO debe tomarse del catálogo (z.ai no lo necesita, pero DevEngine sí).

## Implementación

- `src/providers/softtek-provider.ts`: `CanonicalModelMeta`,
  `lookupCanonicalModelMeta()`, `fetchDevengineContextWindow()`, y
  `buildSofttekProviderConfig({contextWindow, maxTokens, meta})` que usa `meta` para
  `reasoning`/`input`/`thinkingLevelMap` + conservar el `compat` de ADR-0009.
- `src/settings.ts`: `readDevengineConfig()` devuelve `contextWindow`/`maxTokens`
  **nullables** (`null` = sin override → el caller resuelve).
- `src/pi-session.ts`: antes de `registerProvider(SOFTTEK_PROVIDER, …)` resuelve la
  prioridad (override > gateway > catálogo > default) y pasa `meta` al builder. El
  paso 2 (gateway) está guardado por `devKey && willUseDevengine` (ver arriba).
- `package.json`: `frida.devengine.contextWindow`/`maxTokens` con `type: ["number","null"]`,
  `default: null`.

## Consecuencias

- **Positivas:** el contextWindow deja de estar hardcodeado; refleja el modelo real
  (400000) o el gateway real (auto-detect) salvo override; los metadatos canónicos
  (`thinkingLevelMap`, `input`) enriquecen el modelo sin código extra; el override
  explícito sigue siendo la salida de escape si el gateway da problemas.
- **Negativas:** cambio de behavior — los usuarios que **no** tocaron
  `frida.devengine.contextWindow` pasan de 300000 (default anterior) al valor resuelto
  (gateway o 400000); el auto-detect añade un `GET /models` al arrancar (latencia ≤10s,
  best-effort, no bloquea si falla).
- **Riesgo mitigado:** el catálogo (400000) es la mayoría de las veces; el override
  explícito permite bajar si reviven los `500`; el `compat` de ADR-0009 se conserva
  (el reasoning sigue funcionando igual); el auto-detect es no-bloqueante.

## Fuera de alcance

- Auto-detect de `maxTokens`/`reasoning`/`compat` del gateway (sólo contextWindow; los
  demás del catálogo canónico).
- Re-validación en runtime del contextWindow tras un cambio de modelo (se resuelve al
  crear/abrir sesión, como antes).
