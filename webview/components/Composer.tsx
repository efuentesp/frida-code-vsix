import { useEffect, useRef, useState } from "react";

interface Files {
  query: string;
  items: string[];
}

export function Composer({
  onSubmit,
  onSearch,
  files,
}: {
  onSubmit: (text: string) => void;
  onSearch: (query: string) => void;
  files?: Files;
}) {
  const [text, setText] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bashMode = text.trimStart().startsWith("!");

  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    setSel(0);
  }, [activeQuery, files]);

  const suggestions =
    activeQuery !== null && files && files.query === activeQuery ? files.items : [];
  const open = suggestions.length > 0;

  function detectQuery(value: string, caret: number): string | null {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at === -1) return null;
    if (at > 0 && !/\s/.test(before[at - 1])) return null; // @ debe iniciar token
    const q = before.slice(at + 1);
    if (q.includes("\n") || q.includes(" ")) return null; // ya cerró el token
    return q;
  }

  function grow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  function recompute(el: HTMLTextAreaElement) {
    grow(el);
    const q = detectQuery(el.value, el.selectionStart ?? 0);
    if (q !== null && q.length >= 1) {
      if (q !== activeQuery) {
        setActiveQuery(q);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onSearch(q), 120);
      }
    } else if (activeQuery !== null) {
      setActiveQuery(null);
    }
  }

  function insert(item: string) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const value = el.value;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const at = before.lastIndexOf("@");
    if (at === -1) return;
    const next = before.slice(0, at) + "@" + item + " " + after;
    setText(next);
    setActiveQuery(null);
    const pos = at + 1 + item.length + 1;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      grow(el);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (open) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSel((s) => Math.min(s + 1, suggestions.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSel((s) => Math.max(s - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        insert(suggestions[sel]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setActiveQuery(null);
        return;
      }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        onSubmit(text.trim());
        setText("");
      }
    }
  }

  return (
    <div className={"bar" + (bashMode ? " bash-mode" : "")}>
      {open && (
        <div className="file-popup">
          {suggestions.map((f, i) => (
            <div
              key={f}
              className={"file-item" + (i === sel ? " sel" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                insert(f);
              }}
            >
              {f}
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        className="input"
        rows={1}
        placeholder={bashMode ? "$ ejecuta bash…  (! = envía al modelo · !! = no envía)" : "Pídele algo a Frida…  (@ = archivo · ! = bash · Enter = enviar)"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          recompute(e.target);
        }}
        onKeyUp={(e) => recompute(e.target as HTMLTextAreaElement)}
        onClick={(e) => recompute(e.target as HTMLTextAreaElement)}
        onKeyDown={onKeyDown}
      />
      <div className="hint">@ = archivos · ! ejecuta y envía · !! ejecuta sin enviar · Enter envía</div>
    </div>
  );
}
