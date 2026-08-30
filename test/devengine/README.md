# Suite de pruebas DevEngine

Suite de pruebas end-to-end para el proveedor **Softtek DevEngine** de Frida Code.

## 🎯 Qué cubre

| Dimensión | Archivo | Pruebas | Tiempo |
|-----------|---------|---------|--------|
| Tools conformance | `tools-conformance.test.ts` | 3 | <1s |
| Diagnóstico de gateway | `gateway-diagnosis.test.ts` | 10 | <1s |
| **Firmas de fallo en streaming** (incidente 29-30/ago, sin red) | `stream-failure-signatures.test.ts` | 3 | ~2s |
| Live regression (gate issues reporte 1) | `e2e/live-regression.e2e.test.ts` | 4 probes | ~1 min |
| Live stability (soak, detecta firmas A/B) | `e2e/live-stability.e2e.test.ts` | 1 | ~10-40 min |
| Live tools E2E | `e2e/live-tools.e2e.test.ts` | 15 | ~5 min |
| Live reasoning | `e2e/live-reasoning.e2e.test.ts` | 4 | ~2 min |
| Live multiturn | `e2e/live-multiturn.e2e.test.ts` | 2 | ~1 min |
| **Total** | | **~40** | **~50 min** |

## ⚙️ Configuración

### Credenciales

Las pruebas live requieren la API key de DevEngine. Configúrala en **una de estas fuentes**:

#### Opción 1: Variable de entorno (recomendada para CI)

```bash
export DEVENGINE_API_KEY="tu-key-aqui"
```

#### Opción 2: Archivo de auth de Frida

Crea o edita `~/.frida/auth.json`:

```json
{
  "softtek-devengine": {
    "access": "tu-key-aqui"
  }
}
```

### Variables opcionales

| Variable | Default | Descripción |
|----------|---------|-------------|
| `DEVENGINE_BASE_URL` | `https://mywork.softtek.com/apg/devengine` | URL base del gateway |
| `DEVENGINE_MODEL` | `gpt-5.4-mini` | Modelo para las pruebas |
| `DEVENGINE_TIMEOUT` | `120000` | Timeout por prueba (ms) |

## 🚀 Comandos

```bash
# Todas las pruebas del provider
npx vitest run test/devengine/

# Solo conformance (sin red, rápido)
npx vitest run test/devengine/tools-conformance.test.ts

# Firmas de fallo del incidente de streaming (determinista, sin red)
npx vitest run test/devengine/stream-failure-signatures.test.ts

# Gate de regresión de los issues del primer reporte (P1-P4)
DEVENGINE_API_KEY="tu-key" npx vitest run test/devengine/e2e/live-regression.e2e.test.ts

# Soak de estabilidad (dispara y clasifica firmas A/B del incidente)
DEVENGINE_API_KEY="tu-key" npx vitest run test/devengine/e2e/live-stability.e2e.test.ts

# Solo live tools (matriz completa)
npx vitest run test/devengine/e2e/live-tools.e2e.test.ts

# Solo reasoning
npx vitest run test/devengine/e2e/live-reasoning.e2e.test.ts

# Solo multiturn
npx vitest run test/devengine/e2e/live-multiturn.e2e.test.ts

# Con modelo custom
DEVENGINE_MODEL="gpt-4o" npx vitest run test/devengine/e2e/

# Watch mode durante desarrollo
npx vitest watch test/devengine/
```

## 📊 Reportes

Cada suite live genera un reporte markdown en `test/devengine/e2e/`:

- `reporte-tools-devengine.md` — Resultados de la matriz de tools
- `reporte-reasoning-devengine.md` — Resultados de reasoning × effort
- `reporte-multiturn-devengine.md` — Resultados de conversaciones multiturno

Los reportes se regeneran en cada corrida y son útiles para:
- Auditar qué tools/efforts funcionan
- Diagnosticar regresiones
- Compartir evidencia con el equipo del gateway

### Incidente de streaming 29-30/ago (fix-frida-gateway-2.md)

El gateway falló episódicamente con dos firmas: error SSE en español sin status
(FIRMA A) y sin respuesta >60s (FIRMA B). Detalles y repro:

- `stream-failure-signatures.test.ts` reproduce ambas firmas deterministamente
  (servidor SSE local) + caso CONTROL que exonera al cliente.
- `e2e/live-stability.e2e.test.ts` dispara N requests reales por modelo y
  clasifica cada fallo por firma (`reporte-stability-devengine.md`).
- `e2e/live-regression.e2e.test.ts` es el gate de los P1-P4 del primer
  reporte (`reporte-regresion-devengine.md`) — ROJO mientras el gateway no
  los resuelva; al pasar en verde, Frida retira los workarounds (ADR-0009).

## 🔍 Bugs conocidos de DevEngine (ADR-0009)

Las pruebas incluyen **detectores** para bugs conocidos del gateway:

### 1. `requiresThinkingAsText`

**Síntoma:** El gateway devuelve `reasoning_content` en el stream pero lo rechaza en el historial → 500 en turno 2.

**Fix en el host:** `compat.requiresThinkingAsText: true` traduce reasoning_content a texto plano.

**Detector:** `live-reasoning.e2e.test.ts` envía historial con reasoning_content y espera 500.

### 2. `requiresAssistantAfterToolResult`

**Síntoma:** El gateway rechaza `content: null` en mensajes assistant con tool_calls → 500.

**Fix en el host:** `compat.requiresAssistantAfterToolResult: true` envía `content: ""` en vez de `null`.

**Detector:** `live-tools.e2e.test.ts` envía historial con content:null y espera 500.

## 🆚 vs Frida Enterprise

Esta suite es un **subset** de las pruebas de FE adaptado a DevEngine:

| Característica | FE | DevEngine |
|----------------|----|-----------| 
| Adapter complejo | ✅ | ❌ (usa OpenAI estándar) |
| Identidad obligatoria | ✅ | ❌ |
| Dual-endpoint | ✅ | ❌ (solo chat/completions) |
| Embeddings | ✅ | ❌ |
| Pruebas deterministas | ✅ | ❌ (solo live) |
| **Total pruebas** | **139** | **~24** |

Las diferencias se deben a que DevEngine es más simple: sin adapter custom, sin identidad obligatoria, sin embeddings.

## 🐛 Troubleshooting

### Las pruebas se saltan con "No credential found"

Verifica que la key está configurada:

```bash
# Opción 1: env var
echo $DEVENGINE_API_KEY

# Opción 2: archivo
cat ~/.frida/auth.json | jq '.["softtek-devengine"]'
```

### Timeout en pruebas live

Incrementa el timeout:

```bash
DEVENGINE_TIMEOUT=300000 npx vitest run test/devengine/e2e/
```

### Error 401/403 del gateway

La key expiró o es inválida. Reautentica desde el host:

1. Abre Frida Code
2. Cambia al modelo DevEngine
3. Sigue el flow de autenticación
4. La nueva key se guarda en `~/.frida/auth.json`

### Error 500 inesperado

Los detectores de bugs esperan 500 en casos específicos. Si ves 500 en un caso que debería funcionar:

1. Revisa `reporte-*.md` para el detalle del error
2. Compara el payload con el que funciona en el host
3. Verifica si el gateway cambió su comportamiento

## 📚 Referencias

- Estrategia completa: `frida-llops/devengine/docs/TEST-STRATEGY.md`
- ADR-0009 (bugs de DevEngine): `frida-llops/devengine/docs/ADR-0009-devengine-compat.md` (si existe)
- Código del provider: `src/providers/softtek-provider.ts`
