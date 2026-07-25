import { useEffect, useRef, useState } from "react";
import { Maximize2, Send, Square } from "lucide-react";
import { Tooltip } from "./Tooltip";
import type { ImageAttachment, ProviderOption } from "../types";

interface Files {
  query: string;
  items: string[];
}

// Item de comando para el autocompletado de "/": built-in, skills y prompts cargados.
export interface CommandItem {
  kind: "builtin" | "skill" | "prompt";
  label: string; // "/compact", "/skill:foo" o "/foo"
  name: string;
  description: string;
  argumentHint?: string;
}

// Ranking fuzzy (subsequence) para el autocompletado de "/" (igual espíritu que @).
function subseqScore(text: string, q: string): number {
  let ti = 0, qi = 0, score = 0, consecutive = 0;
  while (ti < text.length && qi < q.length) {
    if (text[ti] === q[qi]) { consecutive++; score += 1 + consecutive; qi++; }
    else consecutive = 0;
    ti++;
  }
  return qi < q.length ? -1 : score;
}
function cmdScore(cmd: CommandItem, q: string): number {
  const ql = q.toLowerCase();
  if (!ql) return 0;
  const name = cmd.name.toLowerCase();
  const label = cmd.label.toLowerCase();
  let score = subseqScore(name, ql);
  if (score < 0) score = subseqScore(label, ql) - 1;
  if (score < 0) return -1;
  if (name.startsWith(ql)) score += 20;
  if (name === ql) score += 30;
  return score;
}

export function Composer({
  onSubmit,
  onSearch,
  files,
  commands,
  models,
  busy,
  onAbort,
}: {
  onSubmit: (text: string, mode: "steer" | "followUp", images?: ImageAttachment[]) => void;
  onSearch: (query: string) => void;
  files?: Files;
  commands?: CommandItem[];
  models?: { providers: ProviderOption[] };
  busy?: boolean;
  onAbort?: () => void;
}) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<ImageAttachment[]>([]);
  const historyRef = useRef<string[]>([]);
  const histIdx = useRef(-1);
  const draftRef = useRef("");
  const [activeQuery, setActiveQuery] = useState<string | null>(null); // "@"
  const [commandQuery, setCommandQuery] = useState<string | null>(null); // "/"
  const [argQuery, setArgQuery] = useState<{ command: string; prefix: string } | null>(null); // argumento de /login /model
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorText, setEditorText] = useState("");
  const [sel, setSel] = useState(0);
  const ref = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bashMode = text.trimStart().startsWith("!");

  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    setSel(0);
  }, [activeQuery, commandQuery, argQuery, files]);

  // Comandos cuyo argumento se autocompleta (/login, /logout, /model).
  const ARG_COMMANDS = new Set(["login", "logout", "model"]);

  // --- Autocompletado de archivos (@): host-driven ---
  const suggestions =
    activeQuery !== null && files && files.query === activeQuery ? files.items : [];
  const fileOpen = suggestions.length > 0;

  // --- Autocompletado de comandos (/): filtrado local sobre skills+prompts ---
  const commandMatches =
    commandQuery !== null && commands
      ? commands
          .map((c) => ({ c, score: cmdScore(c, commandQuery) }))
          .filter((x) => x.score >= 0)
          .sort((a, b) => b.score - a.score)
          .map((x) => x.c)
      : [];
  const commandOpen = commandMatches.length > 0;

  // Opciones del argumento según el comando (derivadas de models).
  function argOptions(command: string): { value: string; label: string }[] {
    const provs = models?.providers ?? [];
    if (command === "login" || command === "logout") {
      return provs.filter((p) => p.oauth).map((p) => ({ value: p.id, label: p.name }));
    }
    if (command === "model") {
      return provs.flatMap((p) => p.models.map((m) => ({ value: `${p.id}/${m.id}`, label: `${p.name} · ${m.name}` })));
    }
    return [];
  }
  const argMatches = argQuery
    ? argOptions(argQuery.command).filter((o) => {
        const q = argQuery!.prefix.toLowerCase();
        return q === "" || o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q);
      })
    : [];
  const argOpen = argMatches.length > 0;

  function detectQuery(value: string, caret: number): string | null {
    const before = value.slice(0, caret);
    const at = before.lastIndexOf("@");
    if (at === -1) return null;
    if (at > 0 && !/\s/.test(before[at - 1])) return null; // @ debe iniciar token
    const afterAt = before.slice(at + 1);
    // Caso @"ruta con espacios": query = lo escrito tras la comilla inicial.
    if (afterAt.startsWith('"')) {
      const closing = afterAt.indexOf('"', 1);
      if (closing === -1) return afterAt.slice(1); // aún escribiendo dentro
      return null; // comillas cerradas → token completo
    }
    const q = afterAt;
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

  // Detecta modo argumento: "/login <prefix>" → { command, prefix }.
  function detectArg(value: string, caret: number): { command: string; prefix: string } | null {
    const before = value.slice(0, caret);
    const slash = before.lastIndexOf("/");
    if (slash === -1) return null;
    if (slash > 0 && !/\s/.test(before[slash - 1])) return null;
    const afterSlash = before.slice(slash + 1);
    const sp = afterSlash.indexOf(" ");
    if (sp === -1) return null; // sin espacio → modo comando
    const command = afterSlash.slice(0, sp);
    if (!ARG_COMMANDS.has(command)) return null;
    const prefix = afterSlash.slice(sp + 1);
    if (prefix.includes("\n")) return null;
    return { command, prefix };
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
    // argumento de comandos (/login <prefix>, /model <prefix>)
    const aq = detectArg(el.value, caret);
    const same = aq && argQuery && aq.command === argQuery.command && aq.prefix === argQuery.prefix;
    if (!same) setArgQuery(aq);
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
    // Si la ruta tiene espacios, se entrecomilla (@"ruta con espacios").
    const formatted = item.includes(" ") ? `"${item}"` : item;
    // Si es un directorio (termina en '/'), no se añade espacio → se sigue navegando.
    const isDir = formatted.endsWith("/");
    const suffix = isDir ? "" : " ";
    const next = before.slice(0, at) + "@" + formatted + suffix + after;
    setText(next);
    setActiveQuery(null);
    const pos = at + 1 + formatted.length + suffix.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      grow(el);
    });
  }

  // --- Chips de archivos @ adjuntados (feedback de qué se va a incluir) ---
  function extractAtFiles(value: string): { full: string; rel: string }[] {
    const re = /@(?:"([^"]+)"|([^\s@]+))/g;
    const out: { full: string; rel: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(value)) !== null) out.push({ full: m[0], rel: m[1] ?? m[2] });
    return out;
  }

  function removeAt(full: string) {
    const el = ref.current;
    const next = text.replace(full, "").replace(/  +/g, " ").trimStart();
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      if (el) grow(el);
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

  function insertArg(value: string) {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const value_ = el.value;
    const before = value_.slice(0, caret);
    const after = value_.slice(caret);
    const slash = before.lastIndexOf("/");
    const sp = before.indexOf(" ", slash);
    if (slash === -1 || sp === -1) return;
    const next = before.slice(0, sp + 1) + value + " " + after;
    setText(next);
    setArgQuery(null);
    const pos = sp + 1 + value.length + 1;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
      grow(el);
    });
  }

  function readImageFile(file: File): Promise<ImageAttachment> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const r = reader.result as string;
        resolve({ data: r.split(",")[1] ?? "", mimeType: file.type });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function onPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imgs: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        const f = it.getAsFile();
        if (f) imgs.push(f);
      }
    }
    if (imgs.length === 0) return; // texto plano → pegado normal
    e.preventDefault();
    void Promise.all(imgs.map(readImageFile)).then((atts) => setImages((p) => [...p, ...atts]));
  }

  function removeImage(i: number) {
    setImages((p) => p.filter((_, idx) => idx !== i));
  }

  function doSubmit(mode: "steer" | "followUp") {
    if (!text.trim() && images.length === 0) return;
    onSubmit(text.trim(), mode, images.length ? images : undefined);
    const t = text.trim();
    if (t) {
      const h = historyRef.current;
      if (h[0] !== t) { h.unshift(t); if (h.length > 100) h.pop(); }
    }
    setText("");
    setImages([]);
    histIdx.current = -1;
  }

  function sendNow() {
    doSubmit("steer");
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
    } else if (argOpen) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, argMatches.length - 1)); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); insertArg(argMatches[sel].value); return; }
      if (e.key === "Escape") { e.preventDefault(); setArgQuery(null); return; }
    } else {
      const el = e.currentTarget;
      const atStart = el.selectionStart === 0 && el.selectionStart === el.selectionEnd;
      const atEnd = el.selectionStart === text.length && el.selectionStart === el.selectionEnd;
      // Historial del input (↑/↓ en los bordes, como bash).
      if (e.key === "ArrowUp" && atStart) {
        const h = historyRef.current;
        if (h.length > 0) {
          e.preventDefault();
          if (histIdx.current === -1) { draftRef.current = text; histIdx.current = 0; }
          else if (histIdx.current < h.length - 1) histIdx.current++;
          setText(h[histIdx.current]);
          requestAnimationFrame(() => { el.setSelectionRange(0, 0); grow(el); });
        }
        return;
      }
      if (e.key === "ArrowDown" && histIdx.current >= 0 && atEnd) {
        e.preventDefault();
        const h = historyRef.current;
        if (histIdx.current === 0) { setText(draftRef.current); histIdx.current = -1; }
        else { histIdx.current--; setText(h[histIdx.current]); }
        requestAnimationFrame(() => { const n = el.value.length; el.setSelectionRange(n, n); grow(el); });
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSubmit(e.altKey ? "followUp" : "steer");
      }
    }
  }

  const atFiles = extractAtFiles(text);

  return (
    <div className={"bar" + (bashMode ? " bash-mode" : "")}>
      {fileOpen && (
        <div className="file-popup">
          {suggestions.map((f, i) => (
            <div
              key={f}
              className={"file-item" + (i === sel ? " sel" : "") + (f.endsWith("/") ? " dir" : "")}
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
              <span className={"cmd-kind " + c.kind}>{c.kind === "builtin" ? "cmd" : c.kind}</span>
              <code className="cmd-label">{c.label}</code>
              {c.argumentHint && <span className="cmd-arg">{c.argumentHint}</span>}
              {c.description && <span className="cmd-desc">{c.description}</span>}
            </div>
          ))}
        </div>
      )}
      {argOpen && (
        <div className="file-popup">
          {argMatches.map((o, i) => (
            <div
              key={o.value}
              className={"file-item" + (i === sel ? " sel" : "")}
              onMouseDown={(e) => {
                e.preventDefault();
                insertArg(o.value);
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
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
          onPaste={onPaste}
          onKeyUp={(e) => recompute(e.target as HTMLTextAreaElement)}
          onClick={(e) => recompute(e.target as HTMLTextAreaElement)}
          onKeyDown={onKeyDown}
        />
        <Tooltip label="Editor ampliado" side="top">
          <button className="send-btn ghost" onClick={() => { setEditorText(text); setEditorOpen(true); }}>
            <Maximize2 size={15} />
          </button>
        </Tooltip>
        {busy ? (
          <Tooltip label="Detener" side="top">
            <button className="send-btn stop" onClick={() => onAbort?.()}>
              <Square size={15} />
            </button>
          </Tooltip>
        ) : (
          <Tooltip label="Enviar (Enter)" side="top">
            <button className="send-btn" onClick={sendNow} disabled={!text.trim()}>
              <Send size={16} />
            </button>
          </Tooltip>
        )}
      </div>
      {atFiles.length > 0 && (
        <div className="chips">
          {atFiles.map((f, i) => (
            <span className="chip" key={i}>
              <span className="chip-name">{f.rel}</span>
              <button className="chip-x" onClick={() => removeAt(f.full)} title="Quitar">×</button>
            </span>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="img-chips">
          {images.map((im, i) => (
            <span className="img-chip" key={i}>
              <img className="img-thumb" src={`data:${im.mimeType};base64,${im.data}`} alt="" />
              <button className="chip-x" onClick={() => removeImage(i)} title="Quitar imagen">×</button>
            </span>
          ))}
        </div>
      )}
      <div className="hint">@ archivos · / skill·prompt · ! bash · Enter envía · Alt+Enter = followUp</div>
      {editorOpen && (
        <div className="editor-overlay" onClick={(e) => { if (e.target === e.currentTarget) setEditorOpen(false); }}>
          <div className="editor-modal">
            <textarea
              className="editor-full"
              value={editorText}
              onChange={(e) => setEditorText(e.target.value)}
              placeholder="Escribe tu prompt…"
              autoFocus
            />
            <div className="editor-actions">
              <button className="editor-cancel" onClick={() => setEditorOpen(false)}>Cancelar</button>
              <button
                className="primary-btn"
                onClick={() => {
                  setText(editorText);
                  setEditorOpen(false);
                  doSubmit("steer");
                  requestAnimationFrame(() => { if (ref.current) grow(ref.current); });
                }}
              >
                Enviar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
