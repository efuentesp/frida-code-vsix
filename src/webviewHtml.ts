// Webview de Frida — Fase 1 (UX tipo Claude Code sobre el mismo protocolo postMessage).
// Sin dependencias externas: markdown renderer propio (escape-first), iconos SVG inline,
// todo dentro del CSP (default-src 'none'; script-src 'nonce'; style-src 'unsafe-inline').

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

// --- Iconos SVG inline (codicon-style) ---
const ICON = {
  user: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2.5 14a5.5 5.5 0 0 1 11 0H2.5Z"/></svg>`,
  spark: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 0l1.5 4.5L14 6l-4.5 1.5L8 12l-1.5-4.5L2 6l4.5-1.5L8 0z"/></svg>`,
  check: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M13.5 4.5L6 12l-3.5-3.5 1-1L6 10l6.5-6.5 1 1z"/></svg>`,
  x: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M8 6.6 12.2 2.4l1.4 1.4L9.4 8l4.2 4.2-1.4 1.4L8 9.4l-4.2 4.2-1.4-1.4L6.6 8 2.4 3.8l1.4-1.4L8 6.6z"/></svg>`,
  chevron: `<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M5.5 4L10 8l-4.5 4-1-1L7.5 8 4.5 5l1-1z"/></svg>`,
  term: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M2 2h12v12H2V2zm1 1v10h10V3H3zm1.5 2 2.5 3-2.5 3H5l2.2-2.6V7.6L5 5h-.5zm4 5h3v1h-3v-1z"/></svg>`,
  edit: `<svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M11.5 2.5l2 2L5 13H3v-2l8.5-8.5zm-1 1L4 10v2h2l6.5-6.5-1-1z"/></svg>`,
};

export function webviewHtml(): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';" />
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body {
    font-family: var(--vscode-font-family), system-ui, sans-serif;
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
    background: var(--vscode-sideBar-background);
    display: flex; flex-direction: column; height: 100vh;
  }
  #log { flex: 1; overflow-y: auto; padding: 12px; scroll-behavior: smooth; }

  /* Turnos */
  .turn { margin-bottom: 14px; }
  .turn + .turn { border-top: 1px solid var(--vscode-panel-border); padding-top: 14px; }
  .row { display: flex; gap: 10px; align-items: flex-start; margin: 6px 0; }
  .avatar { width: 22px; height: 22px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; color: #fff; }
  .avatar.user { background: var(--vscode-button-background); }
  .avatar.ai { background: #6a5acd; }
  .body { flex: 1; min-width: 0; }
  .who { font-size: 11px; opacity: .7; margin-bottom: 2px; }
  .bubble { padding: 4px 0; line-height: 1.5; word-wrap: break-word; overflow-wrap: anywhere; }

  /* Markdown */
  .md p { margin: 4px 0; }
  .md h1, .md h2, .md h3, .md h4 { margin: 10px 0 4px; line-height: 1.25; }
  .md h1 { font-size: 1.3em; } .md h2 { font-size: 1.15em; } .md h3 { font-size: 1.05em; }
  .md ul { margin: 4px 0; padding-left: 20px; }
  .md li { margin: 2px 0; }
  .md code { background: var(--vscode-textCodeBlock-background, rgba(127,127,127,.15)); padding: 1px 4px; border-radius: 3px; font-family: var(--vscode-editor-font-family, monospace); }
  .md pre { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 8px 10px; overflow-x: auto; margin: 6px 0; }
  .md pre code { background: none; padding: 0; font-family: var(--vscode-editor-font-family, monospace); font-size: .92em; line-height: 1.4; }
  .md a { color: var(--vscode-textLink-foreground); }
  .md strong { font-weight: 600; }

  /* Estado: pensando / ejecutando */
  .status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; opacity: .85; padding: 3px 0; }
  .spin { width: 12px; height: 12px; border: 2px solid var(--vscode-editorWidget-border, #555); border-top-color: var(--vscode-button-background); border-radius: 50%; animation: sp 0.7s linear infinite; }
  @keyframes sp { to { transform: rotate(360deg); } }

  /* Tarjetas de tool */
  .tool { border: 1px solid var(--vscode-panel-border); border-radius: 6px; background: var(--vscode-textBlockQuote-background, rgba(127,127,127,.08)); margin: 6px 0; overflow: hidden; }
  .tool-head { display: flex; align-items: center; gap: 7px; padding: 6px 8px; cursor: pointer; user-select: none; }
  .tool-head .ic { display: flex; color: var(--vscode-descriptionForeground); }
  .tool-head .nm { font-family: var(--vscode-editor-font-family, monospace); font-size: .9em; }
  .tool-head .st { margin-left: auto; display: inline-flex; align-items: center; gap: 5px; font-size: 11px; opacity: .8; }
  .tool-head .st.ok { color: var(--vscode-testing-iconPassed, #3fb950); }
  .tool-head .st.err { color: var(--vscode-testing-iconFailed, #f85149); }
  .tool-args { padding: 0 8px 8px; }
  .tool-args pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: var(--vscode-editor-font-family, monospace); font-size: .85em; color: var(--vscode-descriptionForeground); }
  .tool.collapsed .tool-args { display: none; }
  .tool.collapsed .chev { transform: rotate(0deg); }
  .chev { transition: transform .1s; transform: rotate(90deg); opacity: .6; }

  /* Diffs en aprobaciones */
  .diff { background: var(--vscode-diffEditor-background); border: 1px solid var(--vscode-panel-border); border-radius: 6px; padding: 6px 0; margin: 6px 0; font-family: var(--vscode-editor-font-family, monospace); font-size: .88em; overflow-x: auto; max-height: 260px; overflow-y: auto; }
  .diff .ln { white-space: pre; padding: 0 10px; }
  .diff .ln.add { background: var(--vscode-diffEditor-insertedTextBackground); color: var(--vscode-diffEditor-insertedTextForeground, var(--vscode-foreground)); }
  .diff .ln.del { background: var(--vscode-diffEditor-deletedTextBackground); color: var(--vscode-diffEditor-deletedTextForeground, var(--vscode-foreground)); }
  .diff .ln.ctx { opacity: .7; }

  /* Aprobaciones */
  .approval { border: 1px solid var(--vscode-inputOption-activeBorder, var(--vscode-focusBorder)); border-radius: 8px; padding: 10px; margin: 8px 0; background: var(--vscode-list-hoverBackground); }
  .approval .ttl { display: flex; align-items: center; gap: 7px; font-weight: 600; margin-bottom: 4px; }
  .approval .ttl .ic { color: var(--vscode-textLink-foreground); display: flex; }
  .approval .acts { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 4px; padding: 5px 12px; font-family: inherit; font-size: 12px; cursor: pointer; }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.sec { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.sec:hover { background: var(--vscode-button-secondaryHoverBackground); }
  #approvals:empty { display: none; }

  .err { color: var(--vscode-errorForeground); padding: 4px 0; }

  /* Input */
  #bar { padding: 8px 12px 12px; border-top: 1px solid var(--vscode-panel-border); background: var(--vscode-sideBar-background); }
  #input { width: 100%; resize: none; min-height: 28px; max-height: 140px; padding: 8px 10px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); border-radius: 6px; font-family: inherit; font-size: 13px; outline: none; line-height: 1.4; }
  #input:focus { border-color: var(--vscode-focusBorder); }
  #hint { font-size: 11px; opacity: .6; margin-top: 4px; text-align: right; }

  /* Onboarding */
  #overlay { position: fixed; inset: 0; background: var(--vscode-sideBar-background); display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 12px; padding: 24px; z-index: 10; }
  #overlay h2 { margin: 0; display: flex; align-items: center; gap: 8px; }
  #overlay p { opacity: .8; margin: 0; text-align: center; max-width: 420px; }
  #overlay input { width: 80%; max-width: 420px; }
  .hidden { display: none !important; }
</style>
</head>
<body>
  <div id="overlay" class="hidden">
    <h2><span class="avatar ai">${ICON.spark}</span> Frida</h2>
    <p>Introduce tu API key de DevEngine. Se guarda en el keychain del SO (no se versiona).</p>
    <input id="keyInput" type="password" placeholder="mwr-sk-..." />
    <button id="keySend">Guardar key y empezar</button>
  </div>

  <div id="log"></div>
  <div id="approvals"></div>

  <div id="bar">
    <textarea id="input" rows="1" placeholder="Pídele algo a Frida…  (Enter = enviar · Shift+Enter = salto)"></textarea>
    <div id="hint">Enter para enviar</div>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const log = document.getElementById('log');
  const input = document.getElementById('input');
  const overlay = document.getElementById('overlay');
  const approvalsEl = document.getElementById('approvals');

  let pendingAssistant = null;   // { el, md, status, _t }
  let turnEl = null;
  const toolCards = [];          // { tool, el, statusEl, running }

  // ---------- Markdown (escape-first ⇒ seguro) ----------
  function escapeHtml(s){return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");}
  function inlineMd(s){
    s = escapeHtml(s);
    s = s.replace(/\\\`([^\`]+)\\\`/g,'<code>$1</code>');
    s = s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');
    s = s.replace(/(^|[^*])\\*([^*\\n]+)\\*/g,'$1<em>$2</em>');
    s = s.replace(/\\[([^\\]]+)\\]\\((https?:[^)]+)\\)/g,'<a href="$2">$1</a>');
    return s;
  }
  function renderMarkdown(md){
    const lines = md.split("\\n");
    let html = "", i = 0, inCode = false, lang = "", buf = [], listOpen = false;
    const closeList = ()=>{ if(listOpen){ html += "</ul>"; listOpen = false; } };
    while(i < lines.length){
      const line = lines[i];
      const fence = line.match(/^\\\`\\\`\\\`(\\w*)/);
      if(fence){
        if(!inCode){ inCode = true; lang = fence[1]||""; buf = []; }
        else { html += '<pre><code class="lang-'+escapeHtml(lang)+'">'+escapeHtml(buf.join("\\n"))+'</code></pre>'; inCode = false; }
        i++; continue;
      }
      if(inCode){ buf.push(line); i++; continue; }
      if(line.trim()===""){ closeList(); i++; continue; }
      const h = line.match(/^(#{1,4})\\s+(.*)/);
      if(h){ closeList(); const lvl=h[1].length; html += '<h'+lvl+'>'+inlineMd(h[2])+'</h'+lvl+'>'; i++; continue; }
      const li = line.match(/^[-*]\\s+(.*)/);
      if(li){ if(!listOpen){ html += "<ul>"; listOpen = true; } html += '<li>'+inlineMd(li[1])+'</li>'; i++; continue; }
      closeList();
      html += '<p>'+inlineMd(line)+'</p>';
      i++;
    }
    closeList();
    if(inCode) html += '<pre><code>'+escapeHtml(buf.join("\\n"))+'</code></pre>';
    return html;
  }

  function el(tag, cls, html){ const e = document.createElement(tag); if(cls) e.className = cls; if(html!=null) e.innerHTML = html; return e; }
  function scrollDown(){ log.scrollTop = log.scrollHeight; }
  function newTurn(){ turnEl = el('div','turn'); log.appendChild(turnEl); return turnEl; }

  function addUser(text){
    newTurn();
    const row = el('div','row');
    row.appendChild(el('div','avatar user', ${JSON.stringify(ICON.user)} ));
    const body = el('div','body');
    body.appendChild(el('div','who','Tú'));
    const bub = el('div','bubble'); bub.textContent = text; body.appendChild(bub);
    row.appendChild(body); turnEl.appendChild(row);
    scrollDown();
  }

  function startAssistant(){
    const row = el('div','row');
    row.appendChild(el('div','avatar ai', ${JSON.stringify(ICON.spark)} ));
    const body = el('div','body');
    body.appendChild(el('div','who','Frida'));
    const md = el('div','bubble md');
    const status = el('div','status');
    body.appendChild(md); body.appendChild(status);
    row.appendChild(body);
    if(!turnEl) newTurn();
    turnEl.appendChild(row);
    pendingAssistant = { el: md, md: "", status };
    setStatus('Pensando…');
    scrollDown();
  }

  function setStatus(text){
    if(!pendingAssistant) return;
    if(!text){ pendingAssistant.status.innerHTML = ''; return; }
    pendingAssistant.status.innerHTML = '<span class="spin"></span> ' + escapeHtml(text);
    scrollDown();
  }

  function appendDelta(text){
    if(!pendingAssistant) startAssistant();
    pendingAssistant.md += text;
    if(!pendingAssistant._t){ pendingAssistant._t = setTimeout(flushAssistant, 40); }
  }
  function flushAssistant(){
    if(!pendingAssistant) return;
    if(pendingAssistant._t){ clearTimeout(pendingAssistant._t); pendingAssistant._t = null; }
    pendingAssistant.el.innerHTML = renderMarkdown(pendingAssistant.md);
    scrollDown();
  }

  function addTool(tool, args){
    if(!turnEl) newTurn();
    const card = el('div','tool');
    const head = el('div','tool-head');
    const isBash = tool === 'bash';
    head.appendChild(el('span','ic', isBash ? ${JSON.stringify(ICON.term)} : ${JSON.stringify(ICON.edit)} ));
    head.appendChild(el('span','chev', ${JSON.stringify(ICON.chevron)} ));
    head.appendChild(el('span','nm', tool));
    const st = el('span','st'); st.innerHTML = '<span class="spin"></span> ejecutando';
    head.appendChild(st);
    card.appendChild(head);
    const argsBox = el('div','tool-args');
    argsBox.appendChild(el('pre', null, escapeHtml(args||'')));
    card.appendChild(argsBox);
    head.onclick = ()=> card.classList.toggle('collapsed');
    (turnEl||log).appendChild(card);
    toolCards.push({ tool, el: card, statusEl: st, running: true });
    setStatus('Ejecutando ' + tool + '…');
    scrollDown();
  }
  function endTool(tool, isError){
    const c = toolCards.find(c => c.running && c.tool === tool);
    if(!c) return;
    c.running = false;
    c.statusEl.className = 'st ' + (isError ? 'err' : 'ok');
    c.statusEl.innerHTML = (isError ? ${JSON.stringify(ICON.x)} : ${JSON.stringify(ICON.check)} ) + ' ' + (isError ? 'error' : 'ok');
  }

  function renderDiff(text){
    const wrap = el('div','diff');
    text.split("\\n").forEach(line=>{
      const ln = el('div','ln');
      if(line.startsWith('+ ')){ ln.className='ln add'; }
      else if(line.startsWith('- ')){ ln.className='ln del'; }
      else { ln.className='ln ctx'; }
      ln.textContent = line;
      wrap.appendChild(ln);
    });
    return wrap;
  }
  function renderApprovals(list){
    approvalsEl.innerHTML = '';
    for(const a of list){
      const card = el('div','approval');
      const ttl = el('div','ttl');
      ttl.appendChild(el('span','ic', a.kind==='bash' ? ${JSON.stringify(ICON.term)} : ${JSON.stringify(ICON.edit)} ));
      const label = a.kind==='bash' ? 'Ejecución de comando' : ('Edición de archivo' + (a.path?' — '+a.path:''));
      ttl.appendChild(el('span', null, escapeHtml(label)));
      card.appendChild(ttl);
      if(a.command){
        const p = el('pre', null, escapeHtml(a.command));
        p.style.cssText='background:var(--vscode-editor-background);padding:8px;border-radius:6px;overflow-x:auto;margin:6px 0;';
        card.appendChild(p);
      }
      if(a.diff) card.appendChild(renderDiff(a.diff));
      const acts = el('div','acts');
      const bOk = el('button', null, 'Aceptar');
      const bNo = el('button','sec', 'Rechazar');
      bOk.onclick = ()=> vscode.postMessage({ type:'approval_response', id:a.id, decision:'accept' });
      bNo.onclick = ()=> vscode.postMessage({ type:'approval_response', id:a.id, decision:'reject' });
      acts.appendChild(bOk); acts.appendChild(bNo);
      if(a.kind==='diff'){
        const bAll = el('button','sec','Aceptar todas (esta sesión)');
        bAll.onclick = ()=> vscode.postMessage({ type:'approval_response', id:a.id, decision:'accept', acceptAll:true });
        acts.appendChild(bAll);
      }
      card.appendChild(acts);
      approvalsEl.appendChild(card);
    }
    scrollDown();
  }

  function endTurn(){ if(pendingAssistant){ flushAssistant(); setStatus(null); pendingAssistant = null; } }

  window.addEventListener('message', (e)=>{
    const m = e.data; if(!m) return;
    switch(m.type){
      case 'need_key': overlay.classList.remove('hidden'); break;
      case 'key_set':
      case 'session_ready': overlay.classList.add('hidden'); input.focus(); break;
      case 'user': flushAssistant(); addUser(String(m.text)); break;
      case 'turn_start': startAssistant(); break;
      case 'delta': appendDelta(String(m.text)); break;
      case 'tool_start': flushAssistant(); addTool(m.tool, m.args); break;
      case 'tool_end': endTool(m.tool, !!m.isError); break;
      case 'turn_end': endTurn(); break;
      case 'approvals': renderApprovals(m.approvals || []); break;
      case 'error': {
        const r = el('div','row');
        r.appendChild(el('div','avatar user', ${JSON.stringify(ICON.x)} ));
        const b = el('div','body'); b.appendChild(el('div','err','⚠ ' + m.text));
        r.appendChild(b); log.appendChild(r); scrollDown();
        break;
      }
    }
  });

  function send(){ const t = input.value.trim(); if(!t) return; vscode.postMessage({ type:'submit', text:t }); input.value=''; input.style.height='auto'; }
  document.getElementById('keySend').onclick = ()=>{ const k = document.getElementById('keyInput').value.trim(); if(k) vscode.postMessage({ type:'set_key', key:k }); };
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
  input.addEventListener('input', ()=>{ input.style.height='auto'; input.style.height = Math.min(input.scrollHeight, 140)+'px'; });

  vscode.postMessage({ type:'webview_ready' });
  input.focus();
</script>
</body>
</html>`;
}
