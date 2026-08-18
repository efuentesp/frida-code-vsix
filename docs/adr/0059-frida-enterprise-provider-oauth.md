# ADR-0059 — Proveedor "Frida Enterprise" (OAuth corporativo, Compatible API)

**Estado:** Validado en vivo · **Fecha:** 2026-08-15 (validación real: 2026-08-15) · **Relaciona:** ADR-0009 (compat gateway), ADR-0010 (agentDir propio), ADR-0017 (registry de providers), ADR-0018 (selector dinámico)

## Contexto

Frida Platform opera una extensión VSCode propia ("Frida Code Copilot Enterprise",
`FridaPlatform.frida-extension` 2.1.28) que se autentica contra el SSO corporativo
(Auth0 detrás de `extension.enterprise.fridaplatform.online`) y consume LLMs vía un
gateway interno OpenAI-compatible ("Compatible API"). Un análisis de ingeniería
inversa del bundle (`frida-llops/frida-enterprise-reverse-engineering.md`)
reconstruyó el flujo completo:

1. **OAuth2 Authorization Code + PKCE (S256)** contra el portal de login. El
   `redirect_uri` está whitelistado server-side: `vscode://fridaplatform.frida-extension`.
2. El `code` se intercambia por un **Firebase custom token**
   (`azf-fridagpt-extension-auth…/auth/enterprise/token`).
3. `signInWithCustomToken` (Firebase, project `frida-code-copilot-enterprise`) →
   **idToken (~1h) + refreshToken** (REST, sin SDK).
4. Config dinámica: idToken → access_token de backend → `get-env-vars` →
   **`COMPATIBLE_API_URL`** + `MODEL1..4`.
5. LLM: `POST {COMPATIBLE_API_URL}/v1/chat/completions` con
   **`Authorization: Bearer <idToken>`** (streaming SSE; `GET /v1/models` para el
   catálogo; `capabilities:["reasoning","responses"|"chat"]` por modelo).

Queremos que frida code (VSIX) incluya este proveedor de forma nativa, como otro
proveedor más del selector (ADR-0018), reutilizando el runtime OAuth de pi-ai.

## Decisión

**Registrar el proveedor en el `ModelRuntime` con OAuth nativo de pi-ai**
(`registerProvider` + `oauth` + `authHeader: true` + `refreshModels`), siguiendo el
patrón de softtek-devengine (ADR-0017) pero sin API key: los tokens rotan solos.

### Estructura

```
src/providers/
├── api-key-providers.ts          # SIN cambios (este provider NO es de API key)
├── frida-enterprise-provider.ts  # NUEVO: config + oauth + refreshModels + hooks
├── softtek-provider.ts
└── z-ai-provider.ts
```

Puntos de cableado (3 archivos):

1. **`src/pi-session.ts`** — `modelRuntime.registerProvider(FRIDA_ENTERPRISE_PROVIDER,
   buildFridaEnterpriseProviderConfig())` junto al registro de DevEngine, y una
   entrada `extensionFactories` con `createFridaEnterpriseHooks(...)` (sesión
   principal **y** sesiones hijas de workflow, igual que z-ai/DevEngine).
2. **`src/extension.ts`** — `SUPPORTED_PROVIDERS` += `frida-enterprise` (selector,
   onboarding, `/login`) y caso en `providerDisplayName`.

### Flujo de login (UX)

`/login frida-enterprise` (o botón del selector) → `modelRuntime.login(id, "oauth",
makeAuthInteraction())` → `adaptOAuth` (pi-coding-agent) → nuestro `oauth.login`:

1. Genera `state` (10 min TTL) + par PKCE S256.
2. `onProgress(instrucciones)` → toast en el webview con qué hacer.
3. `onAuth({url})` → el host abre el navegador en el portal corporativo.
   **El `redirect_uri` de esa URL viaja base64url-encoded** (ver §Errata-1).
4. **Captura del code:** `onManualCodeInput()` → InputBox nativo. El usuario pega
   la URL que quedó en la barra de direcciones del navegador — la página
   `/redirect` del portal (`…/redirect?redirect_uri=…&code=…&state=…`, countdown
   de 3 s antes de saltar a `vscode://…`) o la propia `vscode://…?code=…`, o el
   `code` pelado. `parseCallbackInput` extrae el `code` de cualquiera de las tres.
   - *Futuro:* si FridaPlatform whitelistea `vscode://softtek.frida-code`,
     registramos un `UriHandler` y el paste desaparece (mismo mecanismo que usa la
     extensión original).
5. `POST /auth/enterprise/token` (code + verifier + redirect_uri **crudo**) → `custom_token`.
6. `POST identitytoolkit…/accounts:signInWithCustomToken` → `{idToken,
   refreshToken, expiresIn}`.
7. `get-env-vars` (best-effort) → `compatibleApiUrl` (se guarda DENTRO de la
   credential: `OAuthCredentials` permite campos extra).
8. Devuelve `{access: idToken, refresh, expires: now+expiresIn−120s,
   compatibleApiUrl}` → pi lo persiste en `~/.frida/auth.json` (ADR-0010).

### Catálogo de modelos (ADR-0018 compatible)

El `baseUrl` real se conoce **después** del login, así que el registro inicial usa
`models: []` (el proveedor aparece en el selector sin modelos hasta autenticarse).
Tras el login, `postModels` → `refreshModelsAsync` → `modelRuntime.refresh` →
nuestro `refreshModels(context)`:

- Lee `context.credential.access` (idToken) y `.compatibleApiUrl`.
- `GET {url}/v1/models` (Bearer idToken) → mapea a `ProviderModelConfig` con
  `context_window_tokens`/`max_output_tokens` (defaults 200k/128k) y
  `reasoning: capabilities.includes("reasoning")`.
- Cada modelo lleva `baseUrl: compatibleApiUrl` → las requests van al gateway
  correcto sin re-registrar nada.

### Requests y refresh

- `api: "openai-completions"` + `authHeader: true` → pi inyecta
  `Authorization: Bearer <idToken>` (exactamente como la extensión original).
- `expires` (epoch-ms, con 120 s de margen) → pi-ai `resolveStoredOAuth` hace
  double-checked refresh → nuestro `refreshToken(cred)` → `POST
  securetoken.googleapis.com/v1/token` (form-urlencoded) → nueva credential. Si aún
  no hay `compatibleApiUrl`, el refresh también reintenta `get-env-vars`.
- `/logout` del host limpia la credential (logout corporativo = borrar local; el
  refreshToken de Firebase no se revoca server-side, igual que la extensión
  original, que sólo hace `signOut()`).

### Paridad de payload (hooks — **obligatorios**, ver §Errata-2)

La extensión original envía tres campos propietarios en el body, y el gateway
**los exige**: sin `user_id` ni `email` responde `422 Unprocessable Entity`
(`Field required`, FastAPI/Pydantic). Los inyectamos vía
`before_provider_request` (sólo para nuestro provider):
- `user_id` / `email`: decodificados del **payload JWT del idToken** (sin verify —
  el gateway es quien valida la firma).
- `auto_log: true`.
- Traducción `reasoning_effort` (estándar OpenAI que envía pi) → `reasoning:
  {effort}` (formato que usa la Compatible API).

Y `after_provider_response`: 401/403 → `onUnauthorized("frida-enterprise")` →
reintento de login (paridad con z-ai/DevEngine).

## Errata de la ingeniería inversa (hallazgos de la validación en vivo)

Dos supuestos del análisis estático del bundle resultaron incorrectos o
incompletos. Ambos quedaron corregidos en el código y documentados aquí.

### Errata-1: `redirect_uri` base64 en la URL de login

**Síntoma:** el primer login real terminaba en `/home` sin `code` — el portal
ignoraba silenciosamente los params OAuth.

**Causa:** el SPA del portal (`frida-code-enterprise-web`) valida los params de
`/login` con `fIe`, que **decodifica el `redirect_uri` con `atob()`** (`dIe`,
base64url con tolerancia de padding). Si el decode falla — p. ej. porque llega la
URL cruda `vscode://…` — devuelve `null` y **descarta los cuatro params OAuth**;
el usuario autentica normalmente y cae en `/home`. La extensión original envía
`base64("vscode://fridaplatform.frida-extension")`, detalle que el análisis del
bundle de la extensión no capturó porque el encode ocurre en el **portal web**,
no en la extensión.

**Fix (aplicado 2026-08-15):** `buildFridaEnterpriseOAuth().login` construye la
URL con `redirect_uri: b64url(OAUTH.redirectUri)` (base64url sin padding, el
formato que `dIe` espera). El exchange `POST /auth/enterprise/token` mantiene el
`redirect_uri` **crudo** en el body JSON — son dos contratos distintos.

**Contraste del portal (del bundle web, para futura referencia):**
`sessionStorage["extension_oauth_params"]` guarda los params al entrar a `/login`;
tras autenticar (Microsoft/email+password, Firebase del portal), `N` llama
`POST {oIe}/authorize` (`oIe = azf-fridagpt-extension-auth…/auth/enterprise`) con
`Bearer <idToken del portal>` y el body `{redirect_uri (crudo), state,
code_challenge, code_challenge_method:"S256"}` → responde `{code}`; luego navega a
`/redirect?redirect_uri=<enc>&code=<enc>&state=<enc>`, cuya página arma
`vscode://…?code=…&state=…` (`gIe`) y hace `window.location.href` tras un
countdown de 3 s. **El portal genera el `code` server-side contra su propio
`code_challenge`** — no es un Auth0 directo; nuestro flujo pi simplemente consume
el mismo `authorize` indirectamente vía el login del navegador.

### Errata-2: `user_id`/`email` no son opcionales

El ADR original describía el payload propietario como paridad "best-effort" y
"eliminable sin riesgo". Falso: `POST /v1/chat/completions` sin `user_id` o sin
`email` → **HTTP 422** con `{"detail":[{"type":"missing","loc":["body","user_id"]…}]}`.
Los hooks `before_provider_request` que los inyectan (decodificando el JWT del
idToken) son por tanto **parte del contrato del provider**, no un extra. Si el
gateway algún día relaja la validación, el hook seguirá siendo inofensivo.

### Errata-3: la UI pedía API key pre-login (claim "cero cambios de webview" era falso)

**Síntoma:** en la ventana de configuración de proveedores, Frida Enterprise
aparecía con un input de API key (como z.ai) en vez del botón de login OAuth
(como github-copilot).

**Causa (doble):**
1. El webview decide cómo renderizar cada proveedor con un registry declarativo
   (`webview/providers-registry.ts` → `providerMeta(id, oauthFlag)`): si el id no
   está en `PROVIDER_REGISTRY`, el fallback infiere `authType: oauthFlag ?
   "oauth" : "apikey"`. github-copilot está hardcodeado ahí con `authType:
   "oauth"`; frida-enterprise no tenía entrada.
2. El flag `oauth` que envía el host (`postModels` en `src/extension.ts`) era
   `mr.isUsingOAuth(id)`, que a su vez lee `snapshot.auth` poblado por
   `checkProviderAuth` — que **sólo reporta `type:"oauth"` cuando ya existe una
   credential OAuth guardada**. Pre-login → `false` → fallback `apikey`.
   (Copilot no sufre esto por el hardcodeo del punto 1.)

**Fix (aplicado 2026-08-15, ambos puntos):**
1. Entrada en `webview/providers-registry.ts`:
   `{ id: "frida-enterprise", name: "Frida Enterprise", authType: "oauth",
     getKeyUrl: "…/login", blurb: "SSO corporativo…" }` — el punto de extensión
   documentado por el propio archivo ("agregar un proveedor = darle soporte en el
   host + una entrada aquí").
2. `postModels` ahora computa el flag de forma independiente de la credential:
   `oauth: !!mr.isUsingOAuth?.(id) || !!mr.getProvider?.(id)?.auth?.oauth` — el
   `Provider` recomposed por `composeModelProvider` expone `auth.oauth` para todo
   provider registrado con OAuth, con o sin sesión. Esto también corrige el
   tag "suscripción" y la lista de `/login` del command palette pre-login.

El botón de login llama al handler genérico `login_provider` →
`loginProvider(id)` → `modelRuntime.login(id, "oauth", makeAuthInteraction())` —
sin cambios; funciona igual que para copilot.

### Errata-4: `baseUrl` sin `/v1` → 404 en TODA generación; y modelos no-chat en el catálogo

**Síntoma:** login correcto, provider "conectado", selector con modelos… pero al
usar cualquiera → `404 status code (no body)` (a veces `500`).

**Causa 1 (404):** pi-ai (`api:"openai-completions"`) usa el **SDK oficial de
OpenAI**, que hace `POST {baseURL}/chat/completions` **sin anteponer `/v1`** —
la convención del SDK es que el baseURL ya lo incluye. Nuestro `refreshModels`
asignaba `baseUrl = COMPATIBLE_API_URL` (raíz, sin `/v1`) → requests a
`…/llm-compatible-api/chat/completions` → 404. La extensión original no sufre
esto porque concatena `${COMPATIBLE_API_URL}/v1/chat/completions` a mano
(helper propio, no SDK). Verificado en vivo: sin `/v1` → 404; con `/v1` → 200.

**Causa 2 (400 en 16 de 61 modelos):** el gateway sólo sirve
`chat/completions` a modelos con capability `"chat"`. La extensión original
bifurca por modelo (`Iea`: caps con `"responses"` → endpoint `/v1/responses`);
pi-ai no tiene adapter "responses", así que los responses-only (3: HEPHAESTUS-ANVIL,
LEONIDAS-BLADE, PANTHEON-PRIME), los de caps vacías (9) y los embeddings (4)
devuelven `400 "Model 'X' is not available for chat"` — hoy el selector los
listaba igual.

**Fix (aplicado 2026-08-15, ambos):**
1. `refreshModels`: `baseUrl = COMPATIBLE_API_URL.replace(/\/$/,"") + "/v1"`
   (catálogo vivo y fallback MODEL1..4). `fetchFridaEnterpriseModels` sigue
   recibiendo la RAÍZ y añadiendo `/v1/models` ella misma.
2. `fetchFridaEnterpriseModels` filtra modelos sin capability `"chat"`:
   quedan los 45 utilizables; el selector ya no ofrece modelos que darían 400.

**Matriz de compatibilidad OpenAI del gateway (probada en vivo):**

| Aspecto | Veredicto | Nota |
|---|---|---|
| Objetos de respuesta (`chat.completion`, `choices[].message`) | ✅ | estándar |
| Streaming SSE (`chat.completion.chunk` + `delta`) | ✅ | estándar |
| Tool calling (`finish_reason:"tool_calls"`, `tool_calls[].function.{name,arguments}`) | ✅ | arguments como string JSON, estándar |
| `max_tokens` hasta el máximo del catálogo (262k) | ✅ | aceptado sin recorte |
| `reasoning:{effort}` (formato propietario del hook) | ✅ | aceptado |
| Prefijo `/v1` en las rutas | ❌ desviación | obligatorio; el SDK de OpenAI NO lo antepone (causa del 404) |
| `user_id`/`email` en el body | ❌ desviación | obligatorios (Errata-2) |
| Endpoint por modelo (`chat` vs `responses`) | ❌ desviación | pi-ai sólo consume chat/completions → se filtran los no-chat |

Nota residual: las respuestas traen `message.reasoning_content` (estilo
DeepSeek) que pi-ai ignora sin problema — el thinking de estos modelos no se
muestra en la UI, pero no bloquea nada.

### Errata-5: 422 por identidad no inyectada en el payload real de pi

**Síntoma:** el gateway respondía `422 status code (no body)` al usar
`SELENE-CIPHER`, `TIRESIAS-PRISM`, `NIKE-VICTORY` y otros modelos desde frida
code. Una llamada manual con `user_id`, `email` y `auto_log` explícitos devolvía
200.

**Causa:** `before_provider_request` de pi-coding-agent recibe sólo
`{ payload }`; no recibe headers. El hook original intentaba leer
`event.headers.Authorization`, que siempre era vacío, por lo que el gateway no
recibía los campos obligatorios `user_id`/`email`.

**Fix (aplicado 2026-08-16):** `oauth.getApiKey(credentials)` recuerda los claims
del mismo idToken antes de que pi construya el payload; el hook
`before_provider_request` los inyecta junto con `auto_log: true`. Se conserva
`before_provider_headers` como respaldo para el orden del runtime. La cabecera
Bearer sigue siendo gestionada por pi-ai.

**Pruebas:** 24/24 unitarias incluyen el orden real `getApiKey → onPayload` y
verifican que el payload contiene `user_id`, `email`, `auto_log` y la traducción
`reasoning`. El smoke opt-in `frida-enterprise-live.test.ts` recorre todos los
modelos con capability `chat` publicados por producción.

**Resultado live adicional:** con identidad explícita, SELENE-CIPHER,
TIRESIAS-PRISM y NIKE-VICTORY devuelven 200; 10 modelos publicados devuelven
502 del backend (`Unknown or unsupported provider`, `OpenAI API request failed`
o `Bedrock API request failed`), por lo que no se puede afirmar que todos los
modelos del catálogo respondan correctamente. El test los reporta individualmente
para detectar drift/configuración del gateway.

## Validación en vivo (2026-08-15, cuenta corporativa real)

Ejecutada con credenciales reales (`efuentes@softtek.com`) reproduciendo el flujo
del provider paso a paso fuera del VSIX, y luego con el VSIX parcheado:

| Paso | Resultado |
|---|---|
| `GET /login` del portal (smoke sin credenciales) | HTTP 200 |
| Login SSO con `redirect_uri` crudo | ✗ params descartados → `/home` sin `code` (Errata-1) |
| Login SSO con `redirect_uri` base64url | ✓ `/redirect?code=…&state=…` |
| `POST /auth/enterprise/token` (code+verifier+redirect crudo) | ✓ `custom_token` (923 chars) |
| `signInWithCustomToken` | ✓ idToken 1085 chars (~1h) + refreshToken; claims `aud: frida-code-copilot-enterprise` |
| `POST /auth/token` + `get-env-vars` | ✓ `COMPATIBLE_API_URL = https://frida.azure-api.net/frida-app-service-llm-compatible-api`; `MODEL1..4 = AEOLUS-GALE, NIKE-VICTORY, TIRESIAS-PRISM, SELENE-CIPHER` |
| Persistencia `~/.frida/auth.json` | ✓ shape `{type:"oauth", access, refresh, expires, compatibleApiUrl, envVars}` (chmod 600) |
| `GET /v1/models` | ✓ **61 modelos** (caps chat/responses/embeddings; ctx 128k–1.05M; incluye `model-router`) |
| `POST /v1/chat/completions` sin `user_id`/`email` | ✗ HTTP 422 `Field required` (Errata-2) |
| `POST /v1/chat/completions` con payload completo | ✓ respuesta correcta; `usage` con `billable_input_tokens`, `cache_read/write_input_tokens`, `cache_hit_pct` |
| Hook real `getApiKey → before_provider_request` | ✓ identidad inyectada; elimina el 422 de pi (Errata-5) |
| Smoke de todos los modelos chat publicados | ⚠ 10/45 devuelven HTTP 502 del backend; no es fallo del cliente, requiere revisar deployments/providers del gateway |

Después del fix: **24/24 tests** (vitest), typecheck limpio (host + webview),
VSIX re-parcheado (`dist/extension.js` 19,728,866 bytes + `dist-webview/` con
entrada de registry; backups `extension.js.bak-frida-enterprise` y
`dist-webview.bak-frida-enterprise` intactos). El fix se aplicó en el worktree
`v0.18.0` (fuente autoritativa; el checkout `main` local está atrasado — es
ancestro del tag) y la referencia `frida-llops/frida-enterprise/`.

## Consecuencias

- **+** Un proveedor corporativo más en el selector, con login SSO y tokens que
  rotan solos; sin secretos del VSIX (todo es flujo estándar RFC 7636 + REST
  pública de Firebase).
- **+** Cero cambios en el *host* del webview para el login: el selector ya
  renderiza providers `oauth` y `postModels` los expone — pero ver Errata-3: el
  webview sí requiere una entrada en su `providers-registry.ts` (metadatos de
  auth por proveedor) además del fix del flag `oauth` en `postModels`.
- **+** Validado end-to-end contra producción con cuenta real; las dos erratas
  quedaron cubiertas por tests de regresión (aserción del base64 + caso de la URL
  `/redirect` en `parseCallbackInput`).
- **−** El paste manual del code es un paso más que en la extensión original
  (deep-link). Mitigado con instrucciones explícitas; eliminable cuando nos
  whitelisteen el redirect.
- **−** `COMPATIBLE_API_URL` es por entorno y puede cambiar; se cachea en la
  credential y se refresca en cada `refreshToken` si falta.
- **Riesgo (no observado):** el gateway podría validar `user-agent`/`origin`
  propios de la extensión original; no se detectó en el bundle ni en las pruebas
  en vivo (curl/node sin UA de la extensión → 200). Si apareciera, se añaden
  headers en el provider config (`headers: {...}`).

## Plan de prueba

1. **Unit (vitest):** ✓ 24/24 — PKCE determinista, `parseCallbackInput` (URL
   vscode:// completa / página `/redirect` del portal / code pelado / basura),
   **login URL con `redirect_uri` base64url** (regresión Errata-1), shape del
   provider config, `oauth.login` con fetch mockeado (happy path + custom_token
   ausente), `refreshToken` (margen de expiración, reintento de env-vars), mapeo
   `/v1/models` **con filtro de modelos no-chat (Errata-4)**, **`refreshModels`
   asigna `baseUrl` con `/v1` (Errata-4)**, hooks (`user_id`/`email`/`auto_log`/
   `reasoning`, 401→onUnauthorized).
2. **Integración local (auto-modificación):** ✓ VSIX parcheado, proveedor en el
   selector, login SSO real, `~/.frida/auth.json` persistido, catálogo real
   (61 modelos brutos → 45 chat), generación real vía `chat/completions`
   (non-stream, stream y tool-calls probados directo contra el gateway).
3. **Smoke público:** ✓ `GET /login` del portal responde 200 (sin credenciales).
