import { Icon } from "./Icon";

const TIPS = [
  "Usa **@** para adjuntar archivos del proyecto al mensaje.",
  "Enter envía · Shift+Enter para salto de línea.",
  "Arriba eliges el modo de aprobación (Manual / Auto-edit / Auto) y el esfuerzo.",
  "Presiona Esc dos veces para detener una respuesta.",
  "Compactar resume el contexto cuando la barra pase de ~70%.",
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
      <ul className="tips">
        {TIPS.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
