import type { CompactionReason, InMessage, Segment, State, ToolState, Turn, Usage, WorkspaceInfo } from "./types";

export const initialState: State = {
  keyNeeded: false,
  busy: false,
  mode: "manual",
  turns: [],
  approvals: [],
  questions: [],
  queued: [],
  isCompacting: false,
  compactions: [],
  usage: { inputTotal: 0, outputTotal: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, contextWindow: 0, contextPercent: 0 },
  nextId: 1,
};

function withLast(turns: Turn[], fn: (t: Turn) => Turn): Turn[] {
  if (turns.length === 0) return turns;
  const last = turns[turns.length - 1];
  return [...turns.slice(0, -1), fn(last)];
}

export function reduce(state: State, msg: InMessage): State {
  switch (msg.type) {
    case "need_key":
      return { ...state, keyNeeded: true };
    case "key_set":
    case "session_ready":
      return { ...state, keyNeeded: false };

    case "user": {
      const turn: Turn = { id: state.nextId, user: msg.text, images: msg.images, segments: [], status: null };
      return { ...state, turns: [...state.turns, turn], nextId: state.nextId + 1, info: undefined };
    }
    case "agent_busy":
      return { ...state, busy: msg.busy };
    case "turn_active":
      return { ...state, turns: withLast(state.turns, (t) => ({ ...t, status: "thinking" })) };

    case "delta":
      return {
        ...state,
        turns: withLast(state.turns, (t) => {
          // Concatena al último segmento de texto; si no, crea uno nuevo (así
          // se preserva el orden texto↔tool).
          const segs = [...t.segments];
          const last = segs[segs.length - 1];
          if (last && last.kind === "text") {
            segs[segs.length - 1] = { ...last, text: last.text + msg.text };
          } else {
            segs.push({ kind: "text", text: msg.text });
          }
          return { ...t, segments: segs };
        }),
      };

    case "thinking_delta":
      return {
        ...state,
        turns: withLast(state.turns, (t) => {
          const segs = [...t.segments];
          const last = segs[segs.length - 1];
          if (last && last.kind === "thinking") {
            segs[segs.length - 1] = { ...last, text: last.text + msg.text };
          } else {
            segs.push({ kind: "thinking", text: msg.text });
          }
          return { ...t, segments: segs };
        }),
      };

    case "tool_start":
      return {
        ...state,
        turns: withLast(state.turns, (t) => ({
          ...t,
          status: "executing",
          executingTool: msg.tool,
          segments: [...t.segments, { kind: "tool", tool: msg.tool, args: msg.args ?? {}, state: "running", startedAt: Date.now() }],
        })),
      };

    case "tool_end":
      return {
        ...state,
        turns: withLast(state.turns, (t) => {
          let done = false;
          const segments = t.segments.map((s) => {
            if (!done && s.kind === "tool" && s.state === "running" && s.tool === msg.tool) {
              done = true;
              return { ...s, state: (msg.isError ? "error" : "ok") as ToolState, endedAt: Date.now(), result: msg.result, diff: msg.diff };
            }
            return s;
          });
          // Tras un tool, el modelo vuelve a razonar sobre el resultado antes
          // del siguiente paso → el indicador del footer refleja "Pensando…".
          return { ...t, segments, status: "thinking", executingTool: undefined };
        }),
      };

    // Atajo de bash del usuario (!command / !!command). Se adjunta al turno
    // creado por el mensaje "user" previo y se actualiza con chunks/end.
    case "bash_start":
      return {
        ...state,
        busy: true,
        turns: withLast(state.turns, (t) => ({
          ...t,
          bash: {
            command: msg.command,
            excludeFromContext: msg.excludeFromContext,
            output: "",
            status: "running",
          },
        })),
      };

    case "bash_chunk":
      return {
        ...state,
        turns: withLast(state.turns, (t) =>
          t.bash ? { ...t, bash: { ...t.bash, output: t.bash.output + msg.text } } : t
        ),
      };

    case "bash_end": {
      const status = msg.cancelled
        ? "cancelled"
        : msg.exitCode !== undefined && msg.exitCode !== 0
        ? "error"
        : "ok";
      return {
        ...state,
        busy: false,
        turns: withLast(state.turns, (t) =>
          t.bash
            ? {
                ...t,
                bash: {
                  ...t.bash,
                  status,
                  exitCode: msg.exitCode,
                  truncated: msg.truncated,
                  fullOutputPath: msg.fullOutputPath,
                },
              }
            : t
        ),
      };
    }

    case "approvals":
      return { ...state, approvals: msg.approvals };

    case "questions":
      return { ...state, questions: msg.items };

    case "info":
      return { ...state, info: msg.text };

    case "cleared":
      return { ...state, turns: [], approvals: [], questions: [], queued: [], busy: false, isCompacting: false, compactReason: undefined, compactions: [], info: undefined, usage: { inputTotal: 0, outputTotal: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 0, contextWindow: 0, contextPercent: 0 }, resources: undefined };

    case "usage": {
      const { type: _t, ...rest } = msg;
      return { ...state, usage: rest as Usage };
    }

    case "files":
      return { ...state, files: { query: msg.query, items: msg.items } };

    case "sessions":
      return { ...state, sessions: { items: msg.items, currentPath: msg.currentPath } };

    case "resources":
      return { ...state, resources: msg.data };

    case "queued":
      return { ...state, queued: msg.items };

    case "workspace": {
      const { type: _t, ...rest } = msg;
      return { ...state, workspace: rest as WorkspaceInfo };
    }

    case "models":
      return { ...state, models: { providers: msg.providers, active: msg.active } };

    case "oauth_device_code":
      return { ...state, oauthDeviceCode: { userCode: msg.userCode, verificationUri: msg.verificationUri } };

    case "oauth_clear":
      return { ...state, oauthDeviceCode: undefined };

    case "fork_points":
      return { ...state, forkPoints: msg.points };

    case "mode":
      return { ...state, mode: msg.mode };

    case "model_info":
      return { ...state, model: msg.model, provider: msg.provider, thinking: msg.thinking };

    case "todos":
      return { ...state, todos: { tasks: msg.tasks, nextId: msg.nextId } };

    case "tool_toggles":
      return { ...state, toolToggles: { askUserQuestion: msg.askUserQuestion, todo: msg.todo } };

    case "history": {
      const turns: Turn[] = [];
      let id = 1;
      for (const it of msg.items) {
        if (it.role === "user") {
          turns.push({ id: id++, user: it.text, segments: [], status: null });
        } else if (it.role === "assistant") {
          const segs = (it.segments ?? []).map((s): Segment => {
            if (s.kind === "text") return { kind: "text", text: s.text };
            if (s.kind === "thinking") return { kind: "thinking", text: s.text };
            return {
              kind: "tool",
              tool: s.tool,
              args: s.args ?? {},
              state: s.state ?? "ok",
              startedAt: 0,
              endedAt: 0,
              result: s.result,
              diff: s.diff,
            };
          });
          const last = turns[turns.length - 1];
          if (last) {
            last.segments = [...last.segments, ...segs];
          } else {
            turns.push({ id: id++, user: "", segments: segs, status: null });
          }
        }
      }
      return {
        ...state,
        turns,
        approvals: [],
        busy: false,
        isCompacting: false,
        compactions: [],
        info: msg.name ? `Sesión: ${msg.name}` : state.info,
        nextId: id,
      };
    }

    case "compact_start":
      return { ...state, isCompacting: true, compactReason: msg.reason as CompactionReason };

    case "compact_end": {
      let compactions = state.compactions;
      if (!msg.aborted && msg.tokensBefore != null && msg.summary) {
        const afterTurnId = state.turns.length ? state.turns[state.turns.length - 1].id : null;
        compactions = [
          ...compactions,
          { id: state.nextId, afterTurnId, tokensBefore: msg.tokensBefore, summary: msg.summary, reason: msg.reason as CompactionReason },
        ];
      }
      const info = msg.aborted
        ? "Compactación cancelada"
        : msg.errorMessage
        ? "Error al compactar: " + msg.errorMessage
        : msg.tokensBefore != null && msg.summary
        ? `Contexto compactado desde ${msg.tokensBefore.toLocaleString()} tokens`
        : state.info;
      return { ...state, isCompacting: false, compactReason: undefined, compactions, info, nextId: state.nextId + 1 };
    }

    case "error":
      return { ...state, turns: withLast(state.turns, (t) => ({ ...t, error: msg.text })) };

    default:
      return state;
  }
}
