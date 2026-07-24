import { useState } from "react";
import type { QuestionAnswer, QuestionRequest } from "../types";
import { Bot } from "lucide-react";

// Estado de respuesta por pregunta. `custom` (texto libre) reemplaza cualquier
// selección cuando no está vacío; `selected` aplica solo en multi-select.
interface QDraft {
  option?: string;
  selected: string[];
  custom?: string;
  note?: string;
}

const emptyDraft = (): QDraft => ({ selected: [] });

export function QuestionCard({
  request,
  onRespond,
}: {
  request: QuestionRequest;
  onRespond: (r: { answers: QuestionAnswer[]; cancelled: boolean }) => void;
}) {
  const [drafts, setDrafts] = useState<Record<number, QDraft>>(() => {
    const init: Record<number, QDraft> = {};
    request.questions.forEach((_, i) => {
      init[i] = emptyDraft();
    });
    return init;
  });

  const setDraft = (i: number, patch: Partial<QDraft>) =>
    setDrafts((d) => ({ ...d, [i]: { ...d[i], ...patch } }));

  const toAnswer = (i: number, multi?: boolean): QuestionAnswer | null => {
    const d = drafts[i];
    const note = d.note?.trim() || undefined;
    if (d.custom && d.custom.trim()) {
      return { questionIndex: i, kind: "custom", answer: d.custom.trim(), notes: note };
    }
    if (multi && d.selected.length > 0) {
      return { questionIndex: i, kind: "multi", answer: null, selected: d.selected, notes: note };
    }
    if (!multi && d.option) {
      return { questionIndex: i, kind: "option", answer: d.option, notes: note };
    }
    return null;
  };

  const submit = () => {
    const answers: QuestionAnswer[] = [];
    request.questions.forEach((q, i) => {
      const a = toAnswer(i, q.multiSelect);
      if (a) answers.push(a);
    });
    onRespond({ answers, cancelled: answers.length === 0 });
  };

  return (
    <div className="question">
      <div className="ttl">
        <span className="ic">
          <Bot size={14} />
        </span>
        <span>
          Frida te pregunta
          {request.questions.length > 1 ? ` · ${request.questions.length} preguntas` : ""}
        </span>
      </div>
      {request.questions.map((q, i) => {
        const d = drafts[i];
        return (
          <div className="q-block" key={i}>
            <div className="q-header">{q.header}</div>
            <div className="q-text">{q.question}</div>
            <div className="q-options">
              {q.options.map((o) => {
                const checked = q.multiSelect ? d.selected.includes(o.label) : d.option === o.label;
                const toggle = () =>
                  q.multiSelect
                    ? setDraft(i, {
                        selected: checked ? d.selected.filter((s) => s !== o.label) : [...d.selected, o.label],
                      })
                    : setDraft(i, { option: o.label });
                return (
                  <button type="button" key={o.label} className={"q-option" + (checked ? " on" : "")} onClick={toggle}>
                    <span className="q-mark">{q.multiSelect ? (checked ? "☑" : "☐") : checked ? "●" : "○"}</span>
                    <span className="q-opt-body">
                      <span className="q-opt-label">{o.label}</span>
                      {o.description && <span className="q-opt-desc">{o.description}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            <input
              className="q-custom"
              placeholder="Escribe tu propia respuesta…"
              value={d.custom ?? ""}
              onChange={(e) => setDraft(i, { custom: e.target.value })}
            />
            <details className="q-note">
              <summary>Añadir nota {d.note?.trim() ? "✓" : ""}</summary>
              <textarea
                placeholder="Aclara o matiza tu respuesta (opcional)…"
                value={d.note ?? ""}
                onChange={(e) => setDraft(i, { note: e.target.value })}
              />
            </details>
          </div>
        );
      })}
      <div className="acts">
        <button onClick={submit}>Enviar</button>
        <button className="sec" onClick={() => onRespond({ answers: [], cancelled: true })}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
