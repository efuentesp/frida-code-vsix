# frida-enterprise — Proveedor corporativo Frida Platform (OAuth + Compatible API)

> Issue #58 · [ADR-0059](../adr/0059-frida-enterprise-provider-oauth.md) (OAuth) ·
> [ADR-0060](../adr/0060-frida-enterprise-adapter.md) (adaptador) ·
> [ADR-0061](../adr/0061-frida-enterprise-dual-endpoint.md) (dual-endpoint) ·
> Diseño validado en vivo en
> [frida-llops](https://github.com/efuentesp/frida-llops/frida-enterprise/GUIA-INTEGRACION-VSIX.md)

Proveedor del selector con **SSO corporativo de Frida Platform** (sin API key):
OAuth PKCE → custom token Firebase → idToken (~1h, rota solo) + gateway LLM
interno "Compatible API" (OpenAI-compatible con desviaciones compensadas).

## Cómo funciona

```text
/login frida-enterprise
  → abre el portal SSO corporativo (PKCE S256; redirect_uri base64url)
  → tras el SSO, el portal muestra /redirect?…code=… → pegas la URL
     en el InputBox (acepta la URL completa, la vscode://… o el code pelado)
  → code → custom_token → idToken + refreshToken (Firebase REST)
  → idToken → get-env-vars → COMPATIBLE_API_URL (queda en la credential)
  → GET {COMPATIBLE_API_URL}/v1/models → catálogo del selector
```

- **Credential** en `~/.frida/auth.json` (agentDir propio, ADR-0010): access
  (idToken), refresh, expires con margen de 2 min, `compatibleApiUrl`.
- **Catálogo credential-driven**: el registro arranca con `models: []` y el
  catálogo llega tras el login (32 modelos verificados; el selector destaca
  los 4 ⭐ medidos: DEMETER-BLOOM, TITAN-CROWN, MIDAS-GOLD, model-router).
- **Refresh automático**: vencido `expires`, pi-ai refresca solo vía
  securetoken de Firebase — el usuario no vuelve a iniciar sesión.

## Dual-endpoint (ADR-0061)

El gateway son **DOS APIs con reglas distintas**; `apiForCapabilities`
(adapter) enruta por capability del modelo:

| Capability | Endpoint | Adapter pi-ai | Razonamiento |
| --- | --- | --- | --- |
| `responses` | `POST /v1/responses` | `openai-responses` | Nativo: `reasoning_summary_text` → tarjetas de pensamiento |
| sólo `chat` | `POST /v1/chat/completions` | `openai-completions` | `reasoning_effort` → traducido a `reasoning:{effort}` |

## Erratas compensadas en el adaptador

El gateway NO es 100% OpenAI-compatible; cada desviación vive en
`adapter.ts` (funciones puras, testeables sin red):

| # | Desviación | Compensación |
| --- | --- | --- |
| 1 | `redirect_uri` base64url en la URL de login | `oauth.login` lo encodea |
| 2 | `user_id`/`email` obligatorios (422) | hook `before_provider_request` los decodifica del JWT |
| 3 | UI pre-login según registry del webview | entrada `oauth` en `providers-registry.ts` + flag en `postModels` |
| 4 | `baseUrl` debe llevar `/v1`; filtro capability chat | `refreshModels` (catálogo) |
| 8 | role `developer` → 500/422 | traduce `developer→system` en messages e input |
| 11 | título de sesión sin hooks → 422 | `extensionFactories` en `generateSessionTitle` |
| 13 | `output_text`/items reasoning en multi-turno → 500 | `output_text→input_text`; reasoning descartados (**workaround removible** cuando el gateway corrija) |

## Estructura (extensión removible)

```text
src/providers/frida-enterprise/
├── index.ts            # barrel público + runtime compartido (DI)
├── runtime.ts          # holder de identidad (getApiKey → hooks)
├── oauth.ts            # PKCE / login / refreshToken / getApiKey
├── catalog.ts          # catálogo + filtro chat + dual-endpoint
├── adapter.ts          # ★ adaptador PURO (sin I/O ni estado)
├── provider.ts         # buildFridaEnterpriseProviderConfig
├── hooks.ts            # createFridaEnterpriseHooks (delgado)
└── side-channels.ts    # patch streamSimple (title-path y otros)
```

Wiring del host (quitar para remover): 4 ediciones en `src/pi-session.ts`
(import, `registerProvider`, factories de sesión principal e hijas), 4 en
`src/extension.ts` (SUPPORTED_PROVIDERS, displayName, flag oauth, Errata-11),
1 entrada en `webview/providers-registry.ts`.

## Pruebas

`test/frida-enterprise/` + `test/frida-enterprise-provider.test.ts` — 135
deterministas (adapter contrato bidireccional, tools conformance, hooks,
side-channels, provider monolito) + E2E deterministas con servidor grabador
(runtime-payload, tools-roundtrip, title-path, compact-path) + **16 live
opt-in** (`FRIDA_ENTERPRISE_LIVE=1`) contra la cadena real:

```text
FRIDA_ENTERPRISE_LIVE=1 npx vitest run test/frida-enterprise/e2e/live-runtime.e2e.test.ts
```

## Límites honestos

- La captura del `code` es por paste (InputBox): FridaPlatform whitelistea
  `vscode://fridaplatform.frida-extension`, no nuestro `vscode://softtek.frida-code`.
  Si algún día lo whitelistean, un `UriHandler` elimina el paste.
- `/logout` borra la credential local; el refreshToken de Firebase no se
  revoca server-side (paridad con la extensión original).
- El gate de reasoning por modelo es declarativo del catálogo
  (`VERIFIED_MODEL_IDS`); modelos no verificados no aparecen en el selector.
