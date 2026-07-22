# Frida Code (PoC)

Extensión VS Code que embebe el SDK de **Pi** y se conecta por defecto al
**Softtek DevEngine Gateway**, con gates de aprobación tipo Claude Code.

> **No es un perímetro de seguridad.** Ver `CONTEXT.md` §2 y ADR-0001
> (`docs/adr/0001-alcance-disuasivo-no-perimetro.md`).

## Estado: Prueba de concepto

Implementa el núcleo del MVP documentado en `CONTEXT.md`:

- Proveedor DevEngine registrado en código (`api: openai-completions`, auth por
  header `X-Api-Key`).
- Onboarding de API key en `SecretStorage` + rotación por comando y por 401.
- Gates de aprobación vía el evento `tool_call` de Pi (libres / diff / siempre).
- Sesiones en `globalStorageUri`; phone-home a pi.dev desactivado.

## Desarrollo

```bash
npm install
npm run build       # o npm run watch
# En VS Code: F5 (Launch Extension) — abre el panel con "Frida: Abrir panel"
```

## Empaquetar

```bash
npm run package     # produce frida-pi-0.0.1.vsix
```

> **Tarea de empaquetado (ADR-0002):** los nativos de Pi (`photon-node` `.wasm` y
> `clipboard-*` `.node` por plataforma) deben incluirse en el `.vsix` con target
> platforms. Este scaffold los marca como `external` en `esbuild.js`; resolver su
> inclusión es parte del MVP, no de este PoC.

## Notas

- La API key **nunca** se versiona: vive en `SecretStorage` y se inyecta por el
  hook `before_provider_headers` (memoria del proceso, no env ni disco).
- Cosas a verificar en runtime (marcadas en el código): el path exacto del
  gateway (`{baseUrl}/chat/completions`), el flag `reasoning` de `gpt-5.4-mini`,
  y la resolución del modelo tras `registerProvider`.
