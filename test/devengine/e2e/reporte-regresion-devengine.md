# Reporte E2E regresión issues fix-frida-gateway (2026-08-30T13:48:05.234Z)

Endpoint: <https://mywork.softtek.com/apg/devengine> · probes con fetch plano (sin workarounds de Frida)

| Probe | Issue | Esperado | Status | Estado | Detalle |
| --- | --- | --- | --- | --- | --- |
| P1 | Issue 1 — round-trip de reasoning_content | 200 (el gateway acepta su propio reasoning_content) | 200 | ✅ RESUELTO | {"id":"chatcmpl-EIaB9XRkMUOv3oqQwOIcvP9CblkqB","object":"chat.completion","created":1788097683,"model":"gpt-5.4-mini-202 |
| P2 | Issue 2 — content:null con tool_calls | 200 (estándar OpenAI: content puede ser null) | 200 | ✅ RESUELTO | {"id":"chatcmpl-EIaBAfEGR3sVKJdXmelpZbgGgst6N","object":"chat.completion","created":1788097684,"model":"gpt-5.4-mini-202 |
| P3 | Issue 3 — /models expone context_length/context_window | 200 con context_length numérico en cada modelo | 200 | ❌ PENDIENTE | modelos=6 context_length=false · {"object":"list","data":[{"id":"azure-chat-default","object":"model","created":17788459 |
| P4 | Autodescubrimiento — GET /models/{alias} | 200 (detalle del modelo, incluyendo aliases) | 200 | ✅ RESUELTO | {"id":"gpt-5.4-mini","object":"model","created":1786643329,"owned_by":"azure"} |

> Estado global: 3/4 resueltos. Los workarounds de Frida (ADR-0009) se retiran issue por issue cuando su probe pasa.
