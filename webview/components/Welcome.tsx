import { Icon } from "./Icon";

// Los tips se renderizan como JSX (no markdown) para resaltar atajos con <code>.
const TIPS: React.ReactNode[] = [
  (
    <li key="files">
      Usa <code>@</code> para adjuntar archivos del proyecto al mensaje.
    </li>
  ),
  (
    <li key="bash">
      Ejecuta bash rápido: <code>!comando</code> envía el resultado al modelo,{" "}
      <code>!!comando</code> lo ejecuta sin enviarlo.
    </li>
  ),
  (
    <li key="resources">
      Tus <strong>skills</strong>, <strong>prompts</strong> y <strong>extensiones</strong> se cargan de{" "}
      <code>~/.pi/agent</code> (global) y <code>.pi</code> (proyecto). Botón{" "}
      <strong>Recursos</strong> → “Dónde se cargan” para las rutas exactas; pulsa{" "}
      <strong>Recargar</strong> tras añadirlos.
    </li>
  ),
  <li key="enter">Enter envía · Shift+Enter para salto de línea.</li>,
  <li key="mode">Arriba eliges el modo de aprobación (Manual / Auto-edit / Auto) y el esfuerzo.</li>,
  <li key="esc">Presiona Esc dos veces para detener una respuesta.</li>,
  <li key="compact">Compactar resume el contexto cuando la barra pase de ~70%.</li>,
];

export function Welcome() {
  return (
    <div className="welcome">
      <div className="welcome-logo">
        <span className="avatar ai lg">
          <Icon name="spark" size={26} />
        </span>
      </div>
      <h1>Frida Code</h1>
      <p className="welcome-sub">Tu asistente de código sobre DevEngine.</p>
      <ul className="tips">{TIPS}</ul>
    </div>
  );
}
