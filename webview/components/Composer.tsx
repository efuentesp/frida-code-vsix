import { useEffect, useRef, useState } from "react";

interface Files {
  query: string;
  items: string[];
}

// Item de comando para el autocompletado de "/": skills y prompts cargados.
export interface CommandItem {
  kind: "skill" | "prompt";
  label: string; // "/skill:foo" o "/foo"
  name: string;
  description: string;
}

export function Composer({
  onSubmit,
  onSearch,
  files,
  commands,
}: {
  onSubmit: (text: string, mode: "steer" | "followUp") => void;
  onSearch: (query: string) => void;
  files?: Files;
  commands?: CommandItem[];
}) {
  const [text, setText] = useState("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null); // "@"
  const [commandQuery, setCommandQuery] = useState<string | null>(null); // "/"
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bashMode = text.trimStart().startsWith("!");

  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    setSel(0);
  }, [activeQuery, commandQuery, files]);

  // --- Autocompletado de archivos (@): host-driven ---
  const suggestions =
    activeQuery !== null && files && files.query === activeQuery ? files.items : [];
  const fileOpen = suggestions.length > 0;

  // --- Autocompletado de comandos (/): filtrado local sobre skills+prompts ---
  const commandMatches =
    commandQuery !== null && commands
      ? commands.filter((c) => {
          const q = commandQuery.toLowerCase();
          return (
            c.name.toLowerCase().includes(q) ||
            c.label.toLowerCase().includes(q) ||
            c.description.toLowerCase().includes(q)
          );
        })
      : [];
  const commandOpen = commandMatches.length > 0;

  function detectQuery(value: string, caret: number): string | null {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at === -1) return null;
    if (at > 0 && !/\s/.test(before[at - 1])) return null; // @ debe iniciar token
    const q = before.slice(at + 1);
    if (q.includes("\n") || q.includes(" ")) return null; // ya cerró el token
    return q;
  }

  function detectCommand(value: string, caret: number): string | null {
    const before = value.slice(0, caret);
    const slash = before.lastIndexOf("/");
    if (slash === -1) return null;
    if (slash > 0 && !/\s/.test(before[slash - 1])) return null; // / debe iniciar token
    const q = before.slice(slash + 1);
    if (q.includes("\n") || q.includes(" ") || q.includes("@")) return null; // cerró el token
    return q;
  }

  function grow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  }

  function recompute(el: HTMLTextAreaElement) {
    grow(el);
    const caret = el.selectionStart ?? 0;
    // archivos (@)
    const fq = detectQuery(el.value, caret);
    if (fq !== null && fq.length >= 1) {
      if (fq !== activeQuery) {
        setActiveQuery(fq);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => onSearch(fq), 120);
      }
    } else if (activeQuery !== null) {
      setActiveQuery(null);
    }
    // comandos (/) — se activa incluso con query vacío (muestra todos)
    const cq = detectCommand(el.value, caret);
    if (cq !== commandQuery) setCommandQuery(cq);
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

  function insertCommand(cmd: CommandItem) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const value = el.value;
    const before = value.slice(0, caret);
    const after = value.slice(caret);
    const slash = before.lastIndexOf("/");
    if (slash === -1) return;
    const replacement = cmd.label + " ";
    const next = before.slice(0, slash) + replacement + after;
    setText(next);
    setCommandQuery(null);
    const pos = slash + replacement.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      grow(el);
    });
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (fileOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, suggestions.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insert(suggestions[sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); setActiveQuery(null); return; }
    } else if (commandOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, commandMatches.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertCommand(commandMatches[sel]); return; }
      if (e.key === "Escape") { e.preventDefault(); setCommandQuery(null); return; }
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (text.trim()) {
        onSubmit(text.trim(), e.altKey ? "followUp" : "steer");
        setText("");
      }
    }
  }

  return (
    <div className={"bar" + (bashMode ? " bash-mode" : "")}>
      {fileOpen && (
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
      {commandOpen && (
        <div className="file-popup cmd-popup">
          {commandMatches.map((c, i) => (
            <div
              key={c.label}
              className={"file-item cmd-item" + (i === sel ? " sel" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                insertCommand(c);
              }}
            >
              <span className={"cmd-kind " + c.kind}>{c.kind}</span>
              <code className="cmd-label">{c.label}</code>
              {c.description && <span className="cmd-desc">{c.description}</span>}
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={ref}
        className="input"
        rows={1}
        placeholder={bashMode ? "$ ejecuta bash…  (! = envía al modelo · !! = no envía)" : "Pídele algo a Frida…  (@ archivo · / skill·prompt · ! bash · Enter = enviar)"}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          recompute(e.target);
        }}
        onKeyUp={(e) => recompute(e.target as HTMLTextAreaElement)}
        onClick={(e) => recompute(e.target as HTMLTextAreaElement)}
        onKeyDown={onKeyDown}
      />
      <div className="hint">@ archivos · / skill·prompt · ! bash · Enter envía · Alt+Enter = followUp</div>
    </div>
  );
}
