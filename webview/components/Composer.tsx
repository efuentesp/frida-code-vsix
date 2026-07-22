import { useEffect, useRef, useState } from "react";

export function Composer({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const grow = () => {
    const el = ref.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 140) + "px";
    }
  };

  return (
    <div className="bar">
      <textarea
        ref={ref}
        className="input"
        rows={1}
        placeholder="Pídele algo a Frida…  (Enter = enviar · Shift+Enter = salto)"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          grow();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) {
              onSubmit(text.trim());
              setText("");
            }
          }
        }}
      />
      <div className="hint">Enter para enviar</div>
    </div>
  );
}
