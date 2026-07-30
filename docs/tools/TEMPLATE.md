<!--
PLANTILLA DE DOCUMENTACIÓN DE HERRAMIENTA — frida-code
======================================================

Copia este archivo a docs/tools/<nombre>.md para cada herramienta nueva y
rellena los marcadores <!-- ... -->. Las secciones marcadas (##) son fijas:
mantén el orden y los títulos para que /help, el índice del README y la
navegación entre docs sean consistentes.

Marca los TODO con <!-- TODO --> y bórralos al terminar. El nivel de detalle
objetivo es el del README de pi (carpeta de referencia), adaptado al contexto
de Frida (sesiones hijas, gates, webview).
-->

# `<nombre-herramienta>`

> **Estado:** <!-- TODO: PoC · estable · experimental --> · [ADR-XXXX](../adr/) · [diseño](../)

<!-- TODO: una frase: qué es y para qué sirve. Ej.: "Motor de workflows: cadenas de
     etapas tipo DAG que despachan skills en sesiones hijas, con routing, loops y jueces." -->

## ¿Qué es?

<!-- TODO: 2–4 párrafos. El problema que resuelve, el modelo mental y cómo encaja en
     Frida. Nombra los conceptos clave que se detallan abajo. -->

## ¿Cuándo usarla?

<!-- TODO: viñetas de casos de uso reales. Y una viñeta "NO la uses si…"
     (cuándo es overkill o hay algo más simple). -->

## Conceptos

<!-- TODO: glosario de términos que aparecen en el resto del doc. Tabla
     Término → Significado. Define el vocabulario antes de la API. -->

| Término | Significado |
| --- | --- |
| <!-- TODO --> | <!-- TODO --> |

## Uso

<!-- TODO: cómo interactúa el usuario final. Slash command (/<cmd>), comando de
     paleta, panel webview, setting para habilitar/deshabilitar. Ejemplos
     copia-pegables del flujo típico. -->

```text
<!-- TODO: ejemplo de sesión: el usuario escribe /cmd ... y pasa X -->
```

## API / DSL

<!-- TODO: referencia completa de funciones/tipos/opciones que el autor de configs
     o el integrador consume. Una subsección (###) por familia. Incluye firma +
     descripción de cada parámetro + defaults. Esta es la sección más larga. -->

### <!-- TODO: familia 1 -->

```ts
// TODO: firma + ejemplo mínimo
```

## Ejemplos

<!-- TODO: 2–4 ejemplos completos, de simple a complejo, que el usuario pueda copiar.
     Cada ejemplo: objetivo + código + qué esperar. -->

### <!-- TODO: ejemplo 1 — caso simple -->

### <!-- TODO: ejemplo 2 — caso avanzado -->

## Configuración

<!-- TODO: settings (frida.*), variables de entorno (PI_*, FRIDA_*), archivos de
     config en disco y sus rutas. Tabla Clave → tipo → default → descripción. -->

| Clave | Tipo | Default | Descripción |
| --- | --- | --- | --- |
| <!-- TODO --> | <!-- TODO --> | <!-- TODO --> | <!-- TODO --> |

## Integración con Frida

<!-- TODO: cómo se conecta al host: registro en extension.ts, sesiones hijas,
     ApprovalBridge (gates), webview/webBridge, lifecycle hooks. Lo que un
     integrador necesita saber para enchufarla o depurarla. -->

- **Registro:** <!-- TODO: dónde y cómo se monta al activar la extensión -->
- **Sesiones / gates:** <!-- TODO: si abre sesiones hijas, cómo confluyen los gates -->
- **UI:** <!-- TODO: panel fridaWeb, toast, nada -->

## Arquitectura / Internals

<!-- TODO: layout de archivos en src/tools/<nombre>/ y cómo fluye una invocación
     de extremo a extremo. Breve — para que un contribuidor se ubique. -->

```text
src/tools/<nombre>/
  <!-- TODO: archivo.ts — responsabilidad -->
```

## Ver también

- [README](../../README.md) — índice general de Frida Code
- <!-- TODO: [diseño](../<design>.md) -->
- <!-- TODO: [ADR-XXXX](../adr/<adr>.md) -->
- <!-- TODO: herramientas relacionadas -->

## Estado y madurez

<!-- TODO: qué fases están listas, qué falta, riesgos conocidos. Sé honesto sobre
     lo que es PoC vs. production-ready. -->
