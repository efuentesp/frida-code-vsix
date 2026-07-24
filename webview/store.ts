import type { InMessage, State, Turn, Usage, WorkspaceInfo } from "./types";

export const initialState: State = {
  keyNeeded: false,
  busy: false,
  mode: "manual",
  turns: [],
  approvals: [],
  questions: [],
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
      const turn: Turn = { id: state.nextId, user: msg.text, assistantMd: "", status: null, tools: [] };
      return { ...state, turns: [...state.turns, turn], nextId: state.nextId + 1, info: undefined };
    }
    case "turn_start":
      return { ...state, busy: true, turns: withLast(state.turns, (t) => ({ ...t, status: "thinking" })) };

    case "delta":
      return {
        ...state,
        turns: withLast(state.turns, (t) => ({ ...t, assistantMd: t.assistantMd + msg.text })),
      };

    case "tool_start":
      return {
        ...state,
        turns: withLast(state.turns, (t) => ({
          ...t,
          status: "executing",
          executingTool: msg.tool,
          tools: [...t.tools, { tool: msg.tool, args: msg.args ?? "", state: "running" }],
        })),
      };

    case "tool_end":
      return {
        ...state,
        turns: withLast(state.turns, (t) => {
          let done = false;
          const tools = t.tools.map((tc) => {
            if (!done && tc.state === "running" && tc.tool === msg.tool) {
              done = true;
              return { ...tc, state: (msg.isError ? "error" : "ok") as "error" | "ok" };
            }
            return tc;
          });
          // Tras un tool, el modelo vuelve a razonar sobre el resultado antes
          // del siguiente paso → el indicador del footer refleja "Pensando…".
          return { ...t, tools, status: "thinking", executingTool: undefined };
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

    case "turn_end":
      return {
        ...state,
        busy: false,
        turns: withLast(state.turns, (t) => ({ ...t, status: null, executingTool: undefined })),
      };

    case "approvals":
      return { ...state, approvals: msg.approvals };

    case "questions":
      return { ...state, questions: msg.items };

    case "info":
      return { ...state, info: msg.text };

    case "cleared":
      return { ...state, turns: [], approvals: [], questions: [], busy: false, info: undefined, usage: undefined, resources: undefined };

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

    case "workspace": {
      const { type: _t, ...rest } = msg;
      return { ...state, workspace: rest as WorkspaceInfo };
    }

    case "mode":
      return { ...state, mode: msg.mode };

    case "model_info":
      return { ...state, model: msg.model, thinking: msg.thinking };

    case "history": {
      const turns: Turn[] = [];
      let id = 1;
      for (const it of msg.items) {
        if (it.role === "user") {
          turns.push({ id: id++, user: it.text, assistantMd: "", status: null, tools: [] });
        } else {
          const last = turns[turns.length - 1];
          if (last) last.assistantMd += it.text;
          else turns.push({ id: id++, user: "", assistantMd: it.text, status: null, tools: [] });
        }
      }
      return {
        ...state,
        turns,
        approvals: [],
        busy: false,
        info: msg.name ? `Sesión: ${msg.name}` : state.info,
        nextId: id,
      };
    }

    case "error":
      return { ...state, turns: withLast(state.turns, (t) => ({ ...t, error: msg.text })) };

    default:
      return state;
  }
}
