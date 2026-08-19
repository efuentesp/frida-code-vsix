# NutriMetrics — Arquitectura Spine

**Fase**: arquitectura (spine). **Autor**: Winston (Arquitecto). **Idioma**: es.
**Upstream**: `product-brief.md`, `prd.md`, `CONTEXT.md` (glosario, vinculante).
**Contexto**: codebase verde (C1: sin stack, sin código heredado). Este documento fija SOLO los invariotes que impiden que unidades construidas independientemente diverjan: paradigma, límites, reglas de dependencia, propiedad del estado y postura de errores. Todo lo demás es [SEED] o diferido.

**Prueba de decisión aplicada**: cada elemento incluido aquí responde «sí» a: *si dos unidades se construyeran por separado, ¿podrían elegir formas incompatibles?* y la resolución es un trade-off real no obvio.

---

## 1. Paradigma

**Monolito modular hexagonal, local-first, con núcleo de dominio puro.**

La arquitectura es un único despliegue (app personal, un usuario, A1) dividido en módulos de dominio con dependencias unidireccionales, rodeado de puertos (interfaces definidas por el dominio) y adaptadores (proveedores concretos). Motivos: (a) C2 exige estimador sustituible sin tocar dominio — los puertos/adaptadores lo garantizan por construcción; (b) C5/A1 exigen que los datos personales, incluidas las fotos, vivan en el dispositivo por defecto — el «local-first» es una regla estructural, no una opción de configuración del adaptador; (c) el PRD exige verificaciones agnósticas al stack (§Convención): con el núcleo hexagonal, los mismos servicios de aplicación se exponen a la UI y a un arnés de pruebas/CLI, de modo que cada FR se verifica contra el núcleo sin UI.

**Alternativas descartadas**: microservicios (infraestructura injustificada para un usuario; añade red donde C5 pide local); arquitectura en capas clásica MVC/CRUD (acopla el estimador y la UI al modelo, justo lo que C2 prohíbe); event-sourcing/CQRS completo (complejidad innecesaria; la trazabilidad de FR-13 se resuelve con propuesta inmutable + overlay de correcciones, no con un log de eventos global); cliente-servidor con backend (viola el local-first por defecto).

---

## 2. Invariantes

Cada INV es verificable en revisión o por test. Las referencias FR/C/R remiten al PRD.

**Contratos de dominio**

- **INV-1 — Incertidumbre obligatoria y tipada en el kernel**: todo elemento estimado (alimento/ingrediente/porción) lleva un campo de incertidumbre definido en `nucleo-compartido` (tipo compartido, no redefinido por módulo). Cualquier contrato que transporte elementos estimados sin ese campo es inválido. (FR-10)
- **INV-2 — Prohibición estructural de puntuación global**: el modelo de salida del análisis diario y cualquier vista derivada NO contienen campo de puntuación, nota ni ranking agregado. Test negativo sobre el esquema y las vistas. (FR-26)
- **INV-3 — Vocabulario único de porción práctica**: las porciones se expresan con un enum compartido del kernel (pieza, taza, cucharada, puñado, tamaño pequeño/mediano/grande…). El estimador emite ese enum; la UI lo consume; nadie exige gramaje como entrada obligatoria. (FR-9)
- **INV-4 — Trazabilidad por inmutabilidad**: la propuesta original de la estimación es inmutable; las correcciones de la persona se guardan como overlay (valor final + traza de qué se cambió). Nunca se sobrescribe la propuesta original. (FR-13)
- **INV-5 — Solo lo confirmado alimenta el análisis**: el análisis diario y los indicadores consumen exclusivamente la instantánea de registros confirmados; los borradores y elementos excluidos son invisibles para ellos. (FR-14, FR-12)
- **INV-6 — El análisis es función pura y recomputable**: mismo input (día, registros confirmados, perfil) → mismo output; sin efectos secundarios; no muta registros ni mediciones. La ejecución es idempotente por día. (FR-18–FR-25)
- **INV-7 — Parcial siempre distinguible de completo**: la salida del análisis lleva siempre una lista de advertencias (datos faltantes, incertidumbre, cobertura); vacío de advertencias ⇒ análisis completo. Nunca hay «vacío silencioso». (FR-25, FR-18)
- **INV-8 — Dimensiones independientes con contrato fijo**: cada dimensión nutricional es un evaluador independiente con un contrato de salida común (presencia/variedad/nivel + advertencias + método usado cuando aplique). Añadir o quitar una dimensión no modifica a las demás. (FR-19–FR-24)
- **INV-9 — Lenguaje neutral validado en el kernel**: la blocklist de términos prohibidos (regañar/premiar/prescribir/diagnosticar/tratar…) vive en `nucleo-compartido` y se aplica a todo texto generado visible; ningún módulo (recomendaciones, UI, análisis) puede generar texto visible saltándosela. Test de 0 coincidencias. (FR-30, C4)
- **INV-10 — Evidencia citada**: toda recomendación incluye referencias a los datos que la sustentan (registros/mediciones), su incertidumbre y su horizonte temporal como campos del contrato, no como prosa opcional. (FR-28, FR-29)

**Límites y dependencias**

- **INV-11 — Hexagonal estricto**: los módulos de dominio no importan adaptadores, frameworks, UI, ni nombres de proveedores (estimador, almacenamiento, reloj). Verificable con regla de imports/linter. (C2)
- **INV-12 — El estimador es un puerto**: existe una única interfaz `EstimadorNutricional` definida por el dominio; cambiar de proveedor (local ↔ nube) toca solo el adaptador. El dominio nunca conoce el proveedor. (C2, R2)
- **INV-13 — Lectura no escribe**: `analisis`, `recomendaciones` e `indicadores` son lado-lectura: jamás mutan registros, mediciones o perfil. (INV-6 reforzado como regla de módulo)

**Estado**

- **INV-14 — Local-first por defecto**: todos los datos personales —incluidas las fotos— se persisten en el dispositivo. Cualquier envío a la nube (p. ej. estimación) pasa por un puerto, es explícito y documentado con política de retención del proveedor; existe preferencia de no-envío. (C5, R8)
- **INV-15 — Las fotos son referencias, no columnas**: los registros referencian fotos por id; el módulo `media` es dueño de los binarios. Borrar una foto no corrompe el registro: la evidencia queda marcada como ausente. (FR-8, FR-16)
- **INV-16 — Propiedad única de estado**: cada pieza de estado tiene exactamente un módulo dueño (mapa §3). Ciclo de vida del registro de comida (`borrador → confirmado`) es propiedad exclusiva de `comidas`; configuración de cierre es de `cierre`; series de medición son de `mediciones` (sin semántica de sobrescritura). (FR-3–FR-7, FR-17)
- **INV-17 — Regla de día única**: el «día» para análisis, cierre e indicadores se resuelve con un único componente (`DíaResolver` sobre el puerto `Reloj`), en horario local del dispositivo. Prohibido que un módulo calcule su propio límite de día. Test: reloj inyectado fijo. (FR-17–FR-19, FR-31)
- **INV-18 — Sin planificador de comidas**: el único planificador permitido en la app es el cierre diario. No existe ningún subsistema de recordatorios, alarmas o notificaciones de comida. Test negativo de ausencia. (FR-7)

**Errores**

- **INV-19 — Degradar, nunca bloquear**: enumeración vinculante: (a) el cierre nunca falla por datos ausentes (FR-18); (b) una dimensión reporta ausencia, no error (FR-20/21); (c) un elemento incierto se excluye sin bloquear confirmación ni registro (FR-12); (d) si el estimador falla, el registro queda en borrador con marca de estimación fallida/pendiente — jamás se inventa dato (glosario «Elemento incierto»).
- **INV-20 — Results en las fronteras**: ninguna excepción de adaptador/proveedor cruza hacia el dominio ni hacia la UI; toda operación falible devuelve un tipo `Result` con información de degradación. (postura general)

**Verificación**

- **INV-21 — Los FR se verifican contra el núcleo**: cada verificación del PRD se ejecuta como comando/test contra los servicios de aplicación (vía arnés de pruebas), no mediante scraping de UI; la UI es un adaptador más. (§Convención del PRD)

---

## 3. Mapa de límites y propiedad

| Módulo | Rol | Es dueño de | Contrato que publica |
|---|---|---|---|
| `nucleo-compartido` | kernel | Tipos base (`Id`, `Incertidumbre`, `PorciónPráctica`, `Resultado`), blocklist, `Reloj`/`DíaResolver` | Tipos y reglas compartidos; sin estado |
| `perfil` | dominio | Entidad Perfil (única instancia implícita, A1; modelada como entidad por R7) | Lectura/actualización de perfil y objetivo |
| `mediciones` | dominio | Serie temporal de Mediciones (append, edición y borrado que preservan la serie) | Consulta de serie por métrica |
| `comidas` | dominio | Registro de comida (ciclo de vida borrador→confirmado), elementos estimados, overlay de correcciones, referencias a fotos | **Instantánea de registro confirmado** (única vista consumida por análisis/indicadores) |
| `estimacion` | puerto | Nada (sin estado) | Interfaz `EstimadorNutricional` → `PropuestaEstimación` (elementos con porción práctica + incertidumbre) |
| `analisis` | dominio, lectura | AnálisisDiario (estado derivado, recomputable) | Análisis por dimensiones + advertencias |
| `recomendaciones` | dominio, lectura | Textos de recomendación generados | Recomendación con evidencia, incertidumbre, horizonte |
| `cierre` | aplicación | Configuración de hora de cierre; único planificador | Disparo del análisis del día |
| `indicadores` | lectura | Cálculos FR-31–33 | Métricas de señales de éxito |
| `media` | puerto/adaptador | Binarios de fotos (almacenamiento local) | Guardar/recuperar/eliminar foto por id |
| `ui` | adaptador driver | Estado de presentación | Nada (consume servicios de aplicación) |
| `arnes-pruebas` | adaptador driver | Nada | Comandos de verificación de FR (INV-21) |

**Reglas de dependencia** (resumen; INV-11/13 las hacen cumplir):
1. Dominio → solo kernel y contratos publicados de otros módulos de dominio; jamás adaptadores.
2. `analisis`/`recomendaciones`/`indicadores` → consumen la instantánea de `comidas` y series de `mediciones`; nunca sus internos, ni fotos, ni borradores.
3. Adaptadores → implementan puertos del dominio; drivers (UI, arnés) → invocan solo servicios de aplicación.
4. Prohibido: cualquier módulo excepto `cierre` con capacidad de planificación.

---

## 4. Decisiones [SEED] — ajustables sin romper el spine

- **Stack decidido**: TypeScript + **Expo web build** (React en navegador) para habilitar E2E automatizados con agent_browser (Playwright). Trade-off consciente documentado en product-brief: se pierde acceso directo a hardware (báscula sigue entrada manual, fotos via `<input type="file" accept="image/*" capture>` o API `navigator.mediaDevices.getUserMedia`) a cambio de E2E deterministas en CI sin simuladores iOS/Android. Almacenamiento: IndexedDB para binarios de fotos (adaptador `AlmacenamientoFotos` usa `crypto.randomUUID` del navegador, no `node:crypto`); expo-sqlite via `@expo/browser-sqlite` (o similar shim web) para datos estructurados. Q4 cerrada: plataforma web (product-brief actualizado §Incertidumbres).
- **[SEED] Adaptador de estimación por defecto**: API multimodal en la nube tras `EstimadorNutricional`, con preferencia de no-envío configurable; sustituible por motor local sin tocar dominio (INV-12). Política de retención a documentar por historia (Q1, C5).
- **[SEED] Clasificación de alimentos** (fibra, variedad, ultraprocesamiento): tabla estática local v1, ampliable a clasificador (Q2/C6). El método usado queda expuesto en la salida de la dimensión (FR-24).
- **[SEED] Forma exacta de `Incertidumbre`**: nivel ordinal (baja/media/alta), opcionalmente con intervalo; la forma es seed, la presencia es invariante (INV-1).
- **[SEED] Arbol de directorios y nombrado de paquetes**: decidido por las historias; la regla de dependencias (§3) es lo vinculante.
- **[SEED] Arnés de verificación**: runner de tests + CLI fino sobre servicios de aplicación (INV-21); framework concreto a elegir en la primera historia técnica.

---

## 5. Diferido — explícitamente NO decidido aquí

- ~~Elección definitiva de plataforma (nativo vs. web vs. PWA)~~ — **Q4 cerrada**: Expo web decidido (ver §4 Stack decidido).
- Proveedor concreto de estimación y su política de retención — Q1 (el spine fija puerto + local-first; el proveedor es [SEED]/historia).
- Contenido del catálogo de alimentos y método fino de ultraprocesamiento/variedad/fibra — Q2/C6.
- Umbrales de las señales de éxito — Q6/A4.
- Catálogo validado de métricas Omron (se arranca con peso, % grasa, masa muscular, grasa visceral — A3) — C3.
- Formas de datos completas (esquemas íntegros, migraciones, versionado de persistencia).
- Diseño de UI, navegación y visual de tendencias.
- Multiusuario, autenticación y compartición — post-v1 (R7); revisar C4/GDPR antes de cualquier publicación.
- Módulo de análisis clínico de laboratorios — fase posterior con modelo de privacidad propio (no-objetivo del brief).

---

**Criterio de ratificación de próximos artefactos**: las historias deben poder mapear cada FR a un módulo dueño de la §3 y verificar cada INV en revisión; cualquier decisión que contradiga un INV requiere volver a este documento primero.

<!-- aidd: stage=architecture next=epics-and-stories -->
