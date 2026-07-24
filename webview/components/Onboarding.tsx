import { useState } from "react";
import { Bot } from "lucide-react";

export function Onboarding({ onSubmit }: { onSubmit: (key: string) => void }) {
  const [key, setKey] = useState("");
  return (
    <div className="overlay">
      <h2>
        <span className="avatar ai">
          <Bot size={15} />
        </span>{" "}
        Frida Code
      </h2>
      <p>Introduce tu API key de DevEngine. Se guarda en el keychain del SO (no se versiona).</p>
      <input
        type="password"
        placeholder="mwr-sk-..."
        value={key}
        onChange={(e) => setKey(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && key.trim()) onSubmit(key.trim());
        }}
      />
      <button onClick={() => key.trim() && onSubmit(key.trim())}>Guardar key y empezar</button>
    </div>
  );
}
