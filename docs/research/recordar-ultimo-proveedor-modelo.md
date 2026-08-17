# Diagnóstico: "no recuerda el último proveedor y modelo" (se cambia solo a DevEngine)

> Investigación de la sesión del 18-ago (sin issue asociado por decisión del usuario).
> **Fix aplicado:** quirúrgico (Causa B). El diseño de código quedó diferido — ver
> [Diseño diferido](#diseño-diferido-aprobado-conceptualmente-sin-implementar).

## Síntoma reportado

- Al reiniciar Frida Code, siempre "busca cambiarse a dev engine" aunque el usuario
  no lo pida.
- A mitad de sesión aparece el diálogo de confirmación de cambio de proveedor
  ("El proveedor cambió durante el turno sin que tú lo pidieras…") sin solicitud.

## Arquitectura relevante (verificada en código)

La memoria del último modelo **ya existe**: `frida.activeModel` (globalState de VS
Code, `state.vscdb`) se escribe en cada `selectModel()` y al aceptar un cambio
auto-detectado (`src/extension.ts`, `ACTIVE_MODEL_KEY`). El restore corre en
`createFridaSession` (`src/pi-session.ts` ~L803):

```ts
model = modelRuntime.getModel(am.provider, am.modelId); // zai/glm-5.3
if (!model) model = alts[0];  // degrada al 1º del mismo proveedor (warn invisible)
if (!model) model = DevEngine; // fallback final = gpt-5.4-mini del catálogo canónico
```

Un watchdog en `agent_end` compara `session.model` vs `activeModel` y, si difieren,
lanza el diálogo de confirmación (red de seguridad anti-cambio silencioso).

## Causas raíz

### Causa A — máquinas nuevas (Windows/Ubuntu): globalState no viaja

`state.vscdb` es local de la instalación de VS Code; **no** se sincroniza con
`~/.frida`. En una máquina nueva `activeModel` está vacío → `createFridaSession`
**nunca consulta `settings.json`** (que sí viaja y contiene
`defaultProvider/defaultModel` — el SDK lo escribe en cada `setModel`) → cae directo
al fallback DevEngine. El usuario cambia a z.ai a mano → diálogo → al reiniciar, otra
vez.

### Causa B — catálogo rancio (esta Mac): `models-store.json` sombrea el built-in

`ModelRuntime.create({ modelsStorePath: ~/.frida/models-store.json })` carga un
override persistido por proveedor. El archivo databa del 31-jul con un override de
zai que listaba `glm-4.5-air, glm-4.7, glm-5-turbo, glm-5.1, glm-5.2, glm-5v-turbo` —
**sin `glm-5.3`** (que sí existe en el catálogo built-in de pi-ai 0.84.2). El restore
de `zai/glm-5.3` fallaba → degradación silenciosa a `glm-4.5-air` → el watchdog veía
`session.model ≠ activeModel` → **diálogo espurio**.

Quién escribió ese store: el flujo de descubrimiento de modelos
(`discoverModels`/`buildZaiCatalogOverride`, botón del panel Modelos) persiste el
override con el catálogo conocido en ese momento; si el proveedor publica modelos
nuevos después, el store viejo los tapa.

### Causa C — menor: el watchdog no distingue degradación de arranque

Pregunta al final del turno (tarde) y trata igual "el arranque degradó" que "algo
cambió a mitad del turno" (su propósito real).

## Fix aplicado (quirúrgico, Causa B)

```bash
mv ~/.frida/models-store.json ~/.frida/models-store.json.bak
```

Con el store fuera, el catálogo built-in de zai vuelve a resolverse completo y el
restore de `zai/glm-5.3` es exacto. El SDK puede regenerar el store (p. ej. si se
vuelve a ejecutar el descubrimiento) — si vuelve a ranciarse, repetir la operación
contra el archivo nuevo.

**Validación** (Dev Host, F5): recargar ventana y conversar — footer en `zai/glm-5.3`
desde el primer turno, sin diálogo espurio.

**Revertir**: `mv ~/.frida/models-store.json.bak ~/.frida/models-store.json`.

## Diseño diferido (aprobado conceptualmente, sin implementar)

Cadena de restauración de 3 fuentes + auto-sanado + sync:

1. **3 fuentes**: `globalState.activeModel` → `settings.json`
   (`defaultProvider/defaultModel`) → DevEngine. Arregla la Causa A: máquina nueva
   con `~/.frida` sincronizado arranca en el último modelo elegido sin pasar por
   DevEngine.
2. **Discover-on-miss**: si `getModel(zai, id)` falla y hay key guardada, correr
   `discoverZaiModels()` al arrancar (el mismo código del panel) → catálogo fresco →
   restore exacto. Si aún no existe: degradar al 1º del **mismo proveedor** (nunca
   saltar de proveedor) con **aviso visible en el panel** (hoy es un `console.warn`).
3. **Sync de `activeModel` tras degradar**: el arranque actualiza globalState al
   modelo efectivo → el watchdog sólo dispara ante cambios reales mid-turno (Causa C).

Archivos: `src/pi-session.ts` (cadena + discover + exponer modelo efectivo),
`src/extension.ts` (sync globalState + aviso). Tests: orden de fuentes, degradación
con aviso, discover-on-miss con mock.

**Nota**: en máquinas nuevas, mientras el fix no se implemente, hay que elegir z.ai
una vez manualmente (el globalState se puebla por máquina) y de ahí en adelante
recuerda — salvo que el store vuelva a ranciarse (Causa B).
