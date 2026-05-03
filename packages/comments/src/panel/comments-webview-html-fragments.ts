/**
 * HTML fragment generators for the comments webview panel.
 *
 * Each function returns a fragment string. They are composed by the renderer
 * to build the full webview HTML. This separation keeps rendering logic
 * readable and within the ~50 line limit per function.
 */

/** M45-WVC-05: CSP meta tag value — nonce injected at render time. */
export function buildCsp(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "connect-src 'self'",
  ].join("; ");
}

/** Shell CSS embedded in the initial HTML. */
export const SHELL_CSS = `
:root { color-scheme: dark; --panel: var(--vscode-sideBar-background, #181b20); --panel-raised: var(--vscode-list-hoverBackground, #20242c); --line: rgba(255,255,255,.105); --line-strong: rgba(255,255,255,.18); --text: var(--vscode-foreground, #f4f1ea); --muted: var(--vscode-descriptionForeground, #b7afa6); --soft: var(--vscode-disabledForeground, #8f877e); --word-blue: var(--vscode-button-background, #2b6fde); --word-blue-soft: rgba(43,111,222,.17); --comment: #fff5c6; --comment-2: #fffbe8; --comment-line: rgba(87,65,20,.22); --ink: #2c261b; --resolve: #52b36f; --danger: #ef6b68; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 0; height: 100vh; overflow: hidden; background: linear-gradient(180deg, rgba(255,255,255,.035), transparent 11rem), var(--panel); color: var(--text); font-family: var(--vscode-font-family, Inter, ui-sans-serif, system-ui); font-size: var(--vscode-font-size, 13px); }
button { font: inherit; }
.comments-panel { display: grid; grid-template-rows: auto auto 1fr; height: 100vh; min-width: 17.5rem; }
.panel-header { padding: .85rem .85rem .7rem; border-bottom: 1px solid var(--line); }
.title-row, .toolbar-icons, .stats, .filter-row, .file-summary, .file-main, .thread-title, .thread-location, .thread-meta-row, .comment-top, .author, .mini-actions, .composer-actions { display: flex; align-items: center; gap: .5rem; }
.title-row, .file-summary, .thread-title, .comment-top { justify-content: space-between; }
h1 { margin: 0; font-size: .98rem; letter-spacing: .01em; }
.toolbar-icons { gap: .3rem; }
.icon-button { display: grid; width: 1.8rem; height: 1.8rem; place-items: center; border: 1px solid var(--line); border-radius: .55rem; background: rgba(255,255,255,.045); color: var(--muted); cursor: pointer; }
.stats { flex-wrap: wrap; gap: .35rem; margin-top: .7rem; }
.pill { min-width: 0; padding: .25rem .48rem; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.045); color: var(--muted); font-size: .72rem; line-height: 1.1; white-space: nowrap; cursor: pointer; }
.pill.active { border-color: rgba(43,111,222,.6); background: var(--word-blue-soft); color: #dbe9ff; }
.filter-strip { padding: .6rem .7rem; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.025); }
.search { display: flex; align-items: center; gap: .45rem; padding: .38rem .5rem; border: 1px solid var(--line); border-radius: .65rem; background: rgba(0,0,0,.16); color: var(--soft); font-size: .78rem; }
.search-input { min-width: 0; width: 100%; border: 0; outline: 0; background: transparent; color: var(--text); font: inherit; }
.search-input::placeholder { color: var(--soft); }
.filter-row { gap: .35rem; margin-top: .5rem; overflow-x: auto; scrollbar-width: none; }
.filter-row::-webkit-scrollbar { display: none; }
#panel.thread-scroll { min-height: 0; padding: .55rem; overflow: auto; }
.empty { color: var(--soft); text-align: center; padding: 2rem 1rem; font-style: italic; }
.group.file-group { margin-bottom: .55rem; border: 1px solid var(--line); border-radius: .85rem; background: rgba(255,255,255,.028); overflow: hidden; }
.group.file-group.collapsed { background: rgba(255,255,255,.018); }
.group-header.file-header { width: 100%; border: 0; cursor: pointer; padding: .58rem .65rem; background: transparent; color: inherit; text-align: left; user-select: none; }
.group-header.file-header:focus, .thread-header:focus, .icon-button:focus, .link-btn:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
.file-main { min-width: 0; gap: .45rem; }
.chevron { width: .9rem; color: var(--soft); font-size: .68rem; transition: transform 150ms ease; }
.group-header.expanded .chevron { transform: rotate(90deg); }
.file-name { overflow: hidden; color: var(--text); font-size: .82rem; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.file-count { flex: 0 0 auto; color: var(--soft); font-size: .72rem; }
.collapsed-file-preview { display: flex; gap: .28rem; padding: 0 .65rem .58rem 2rem; }
.group-header.expanded + .collapsed-file-preview { display: none; }
.mini-thread-dot { width: .42rem; height: .42rem; border-radius: 999px; background: var(--word-blue); opacity: .78; }
.mini-thread-dot.resolved { background: var(--resolve); }
.group-threads.thread-list { border-top: 1px solid var(--line); }
.thread { border-bottom: 1px solid rgba(255,255,255,.065); }
.thread:last-child { border-bottom: 0; }
.thread.thread-open { background: linear-gradient(90deg, rgba(43,111,222,.16), transparent 4px), rgba(43,111,222,.075); }
.thread-header { display: block; width: 100%; padding: .62rem .65rem; border: 0; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.thread-header:hover { background: rgba(43,111,222,.08); }
.thread-location { min-width: 0; gap: .42rem; }
.status-dot { width: .48rem; height: .48rem; flex: 0 0 auto; border-radius: 999px; background: var(--word-blue); box-shadow: 0 0 0 3px rgba(43,111,222,.13); }
.status-dot.resolved { background: var(--resolve); box-shadow: 0 0 0 3px rgba(82,179,111,.12); }
.line-label { overflow: hidden; color: var(--text); font-size: .78rem; font-weight: 660; text-overflow: ellipsis; white-space: nowrap; }
.reply-count { flex: 0 0 auto; color: var(--soft); font-size: .71rem; }
.thread-reply-summary { display: block; color: var(--muted); font-size: .72rem; margin-top: .12rem; }
.thread-preview { display: none; }
.thread-meta-row { gap: .35rem; margin-top: .45rem; overflow: hidden; }
.tiny-tag { overflow: hidden; padding: .16rem .36rem; border: 1px solid rgba(255,255,255,.09); border-radius: 999px; color: var(--soft); font-size: .66rem; text-overflow: ellipsis; white-space: nowrap; }
.tiny-tag.surface-slide, .tiny-tag.surface-presentation { border-color: rgba(180,80,200,.5); color: #d4a0ff; background: rgba(180,80,200,.12); }
.tiny-tag.surface-markdown-preview, .tiny-tag.surface-md { border-color: rgba(80,160,80,.5); color: #a0d4a0; background: rgba(80,160,80,.12); }
.tiny-tag.surface-browser { border-color: rgba(60,140,220,.5); color: #a0c8ff; background: rgba(60,140,220,.12); }
.tiny-tag.surface-diagram { border-color: rgba(200,140,40,.5); color: #f0c878; background: rgba(200,140,40,.12); }
.tiny-tag.intent-tag { border-color: rgba(200,160,60,.5); color: #f0d898; background: rgba(200,160,60,.1); }
.reply-meta { color: #756650; font-size: .65rem; display: block; margin-top: .1rem; }
.conversation-card { margin: 0 .65rem .65rem; border: 1px solid var(--comment-line); border-radius: .82rem; background: linear-gradient(180deg, var(--comment-2), var(--comment)); color: var(--ink); box-shadow: 0 10px 24px rgba(0,0,0,.2); overflow: hidden; }
.conversation-head { display: flex; justify-content: flex-end; padding: .38rem .55rem; border-bottom: 1px solid rgba(87,65,20,.14); }
.author { min-width: 0; gap: .45rem; }
.avatar { display: grid; width: 1.72rem; height: 1.72rem; flex: 0 0 auto; place-items: center; border-radius: 50%; background: var(--word-blue); color: white; font-size: .68rem; font-weight: 760; }
.avatar.agent { background: #7549be; }
.author-text { min-width: 0; }
.author-text strong, .author-text span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.author-text strong { font-size: .76rem; }
.author-text span, .thread-context { color: #756650; font-size: .66rem; }
.mini-actions { gap: .25rem; }
.mini-actions button, .composer-actions button { border: 1px solid rgba(49,40,23,.16); border-radius: 999px; background: rgba(255,255,255,.46); color: #453922; font-size: .66rem; cursor: pointer; }
.mini-actions button { padding: .2rem .34rem; }
.chip { border: 1px solid rgba(255,255,255,.09); border-radius: 999px; background: rgba(255,255,255,.045); color: var(--soft); font-size: .72rem; cursor: pointer; padding: .2rem .48rem; white-space: nowrap; }
.chip.active { border-color: rgba(43,111,222,.6); background: var(--word-blue-soft); color: #dbe9ff; }
.chip-sep { width: 1px; height: .9rem; background: var(--line); flex: 0 0 auto; }
.quoted { margin-top: .55rem; padding: .46rem .5rem; border-left: 3px solid var(--word-blue); background: rgba(255,255,255,.42); color: #5b4d39; font-size: .7rem; line-height: 1.35; }
.comment { padding: .66rem; border-bottom: 1px solid rgba(87,65,20,.12); }
.comment p { margin: .48rem 0 0; font-size: .77rem; line-height: 1.42; }
.comment.reply { background: rgba(255,255,255,.26); }
.composer { padding: .58rem; background: rgba(255,255,255,.2); }
.composer-box { width: 100%; min-height: 3.4rem; padding: .48rem; border: 1px solid rgba(49,40,23,.15); border-radius: .55rem; background: rgba(255,255,255,.42); color: #7a6a52; font-size: .72rem; line-height: 1.35; resize: vertical; font-family: inherit; box-sizing: border-box; }
.composer-box::placeholder { color: #9e8e76; }
.composer-actions { justify-content: flex-end; margin-top: .46rem; gap: .35rem; }
.composer-actions .primary { border-color: transparent; background: var(--word-blue); color: white; }
.composer-actions .cancel-btn { border-color: transparent; background: rgba(255,255,255,.3); color: #5b4d39; }
`.trim();

/** Build the interactive filter-bar HTML. */
export function buildFilterBarHtml(): string {
  return `<section class="comments-panel">
  <header class="panel-header">
    <div class="title-row">
      <h1>Comments</h1>
      <div class="toolbar-icons" aria-label="Panel actions">
        <button class="icon-button" id="btn-refresh" title="Refresh">↻</button>
        <button class="icon-button" id="btn-clear" title="Clear filters">⌧</button>
      </div>
    </div>
    <div class="stats" aria-label="Active comment filters">
      <button class="pill" id="open-count" data-status-view="open">Open 0</button>
      <button class="pill" id="resolved-count" data-status-view="resolved">Resolved 0</button>
      <button class="pill active" id="total-count" data-status-view="all">Total 0</button>
    </div>
  </header>
  <div class="filter-strip">
    <label class="search" for="comment-search">⌕ <input class="search-input" id="comment-search" type="search" placeholder="Search comments…" aria-label="Search comments" /></label>
    <div class="filter-row" id="filter-chips">
      <button class="chip" id="chip-by-file" data-group="by-file">By file</button>
      <button class="chip" id="chip-by-activity" data-group="by-activity">Activity</button>
      <span class="chip-sep"></span>
      <button class="chip" id="chip-mine" data-author="user">Mine</button>
      <button class="chip" id="chip-agent" data-author="agent">Agent</button>
    </div>
  </div>`;
}

/** Build the initial empty panel placeholder. */
export function buildEmptyPanelHtml(): string {
  return `<div id="panel" class="thread-scroll"><div class="empty">No comments yet.</div></div></section>`;
}

/** Map of action name → VS Code command ID for thread actions. */
export const THREAD_COMMAND_IDS: Record<string, string> = {
  navigateToAnchor: "accordo.commentsPanel.navigateToAnchor",
  reply: "accordo.commentsPanel.reply",
  resolve: "accordo.commentsPanel.resolve",
  reopen: "accordo.commentsPanel.reopen",
  delete: "accordo.commentsPanel.delete",
};

/** Map of action name → display label. */
export const THREAD_ACTION_LABELS: Record<string, string> = {
  navigateToAnchor: "Go",
  reply: "Reply",
  resolve: "Resolve",
  reopen: "Reopen",
  delete: "Delete",
};

/** All thread action names in execution order. */
export const THREAD_ACTIONS = Object.keys(THREAD_COMMAND_IDS);

/**
 * Build the JavaScript bundle for the webview panel.
 *
 * Exported for unit testing of render logic.
 */
export function buildPanelScript(): string {
  const cmdIdsJson = JSON.stringify(THREAD_COMMAND_IDS);
  const actionLabelsJson = JSON.stringify(THREAD_ACTION_LABELS);
  const threadActionsJson = JSON.stringify(THREAD_ACTIONS);

  return `(function() {
  var commandIds = ${cmdIdsJson};
  var actionLabels = ${actionLabelsJson};
  var threadActions = ${threadActionsJson};
  var vscode = acquireVsCodeApi();
  var panel = document.getElementById('panel');
  var searchInput = document.getElementById('comment-search');
  var openCount = document.getElementById('open-count');
  var resolvedCount = document.getElementById('resolved-count');
  var totalCount = document.getElementById('total-count');

  function renderPanel(model) {
    if (searchInput && searchInput.value !== (model.searchQuery || '')) searchInput.value = model.searchQuery || '';
    openCount.textContent = 'Open ' + (model.openThreadCount || 0);
    resolvedCount.textContent = 'Resolved ' + (model.resolvedThreadCount || 0);
    totalCount.textContent = 'Total ' + (model.totalThreadCount || 0);
    updateStatusButtons(model.statusFilter);
    updateGroupButtons(model.groupMode);
    if (!model.groups || model.groups.length === 0) {
      panel.innerHTML = '<div class="empty">No comments match the current filters.</div>';
      return;
    }
    panel.innerHTML = model.groups.map(renderGroup).join('');
    bindPanelEvents();
  }

  function renderGroup(group) {
    var expanded = group.expanded ? ' expanded' : '';
    var collapsed = group.expanded ? '' : ' collapsed';
    var header = '<button class="group-header file-header' + expanded + '" data-group-id="' + escHtml(group.groupId) + '"><div class="file-summary"><div class="file-main"><span class="chevron">▶</span><span>' + groupIcon(group) + '</span><span class="file-name">' + escHtml(group.label) + '</span></div><span class="file-count">' + group.count + '</span></div></button>';
    var preview = '<div class="collapsed-file-preview" aria-hidden="true">' + group.threads.slice(0, 6).map(renderMiniDot).join('') + '</div>';
    var threads = group.expanded ? '<div class="group-threads thread-list">' + group.threads.map(renderThread).join('') + '</div>' : '';
    return '<section class="group file-group' + collapsed + '" data-group-id="' + escHtml(group.groupId) + '">' + header + preview + threads + '</section>';
  }

  function renderThread(thread) {
    var tags = renderThreadTags(thread);
    var card = thread.expanded ? renderConversationCard(thread) : '';
    var replySummary = escHtml(thread.replySummary || '');
    return '<article class="thread' + (thread.expanded ? ' thread-open' : '') + '" data-thread-id="' + escHtml(thread.threadId) + '">' +
      '<button class="thread-header" data-thread-id="' + escHtml(thread.threadId) + '">' +
      '<div class="thread-title"><div class="thread-location"><span class="status-dot ' + (thread.status === 'resolved' ? 'resolved' : '') + '"></span><span class="line-label">' + escHtml(thread.title) + '</span></div><span class="reply-count">' + thread.replyCount + '</span></div>' +
      (replySummary ? '<span class="thread-reply-summary">' + replySummary + '</span>' : '') +
      '<div class="thread-meta-row">' + tags + '</div></button>' + card + '</article>';
  }

  function renderAction(thread, action) {
    return '<button class="link-btn thread-action" data-command-id="' + escHtml(commandIds[action]) + '" data-thread-id="' + escHtml(thread.threadId) + '">' + escHtml(actionLabels[action]) + '</button>';
  }

  function renderConversationCard(thread) {
    var first = thread.comments && thread.comments.length ? thread.comments[0] : null;
    var rest = thread.comments && thread.comments.length > 1 ? thread.comments.slice(1) : [];
    return '<section class="conversation-card" aria-label="Inline conversation"><div class="conversation-head">' + renderConversationActions(thread) + '</div>' + renderMessage(first, false) + rest.map(function(c) { return renderMessage(c, true); }).join('') + renderComposer(thread) + '</section>';
  }

  function renderConversationActions(thread) {
    return '<div class="mini-actions">' + renderPrimaryActions(thread) + '</div>';
  }

  function renderPrimaryActions(thread) {
    var actions = thread.status === 'resolved' ? ['navigateToAnchor', 'reopen', 'delete'] : ['navigateToAnchor', 'resolve', 'reply', 'delete'];
    return actions.map(function(a) { return renderAction(thread, a); }).join('');
  }

  function renderMessage(comment, isReply) {
    if (!comment) return '';
    var avatarClass = comment.authorKind === 'agent' ? ' agent' : '';
    return '<div class="comment' + (isReply ? ' reply' : '') + '"><div class="author"><div class="avatar' + avatarClass + '">' + initialsFor(comment.authorName) + '</div><div class="author-text"><strong>' + escHtml(comment.authorName) + '</strong><span>' + escHtml(comment.createdAt) + '</span></div></div><p>' + escHtml(comment.body) + '</p></div>';
  }

  function renderComposer(thread) {
    var threadId = escHtml(thread.threadId);
    return '<div class="composer" data-thread-id="' + threadId + '">' +
      '<textarea class="composer-box" placeholder="Reply in this thread..." rows="2" data-thread-id="' + threadId + '"></textarea>' +
      '<div class="composer-actions">' +
      '<button class="cancel-btn" data-action="cancel" data-thread-id="' + threadId + '">Cancel</button>' +
      '<button class="reply-btn primary" data-action="reply" data-thread-id="' + threadId + '">Reply</button>' +
      '</div></div>';
  }

  function renderThreadTags(thread) {
    var tags = [];
    if (thread.intent) tags.push('<span class="tiny-tag intent-tag">' + escHtml(thread.intent) + '</span>');
    if (thread.surfaceType) tags.push('<span class="tiny-tag surface-tag surface-' + escHtml(thread.surfaceType) + '">' + escHtml(surfaceLabel(thread.surfaceType)) + '</span>');
    if (thread.stale) tags.push('<span class="tiny-tag">stale</span>');
    return tags.join('');
  }

  function surfaceLabel(surfaceType) {
    var map = { 'slide': 'presentation', 'markdown-preview': 'md', 'browser': 'browser', 'diagram': 'diagram', 'image': 'image', 'pdf': 'pdf' };
    return map[surfaceType] || surfaceType;
  }

  function renderMiniDot(thread) {
    return '<span class="mini-thread-dot ' + (thread.status === 'resolved' ? 'resolved' : '') + '"></span>';
  }

  function groupIcon(group) {
    if (group.kind !== 'file') return '☷';
    if (/^https?:/.test(group.groupId) || /^https?:/.test(group.label)) return '🌐';
    if (group.label.indexOf('.mmd') !== -1) return '🧩';
    if (group.label.indexOf('.md') !== -1) return '📄';
    return '📁';
  }

  function initialsFor(name) {
    return escHtml(String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function(part) { return part.charAt(0).toUpperCase(); }).join('') || '?');
  }

  function bindPanelEvents() {
    panel.querySelectorAll('.group-header').forEach(function(el) {
      bindActivate(el, function() {
        vscode.postMessage({ type: 'panel:toggle-group', groupId: el.dataset.groupId, source: eventSource() });
      });
    });
    panel.querySelectorAll('.thread-header').forEach(function(el) {
      bindActivate(el, function() {
        vscode.postMessage({ type: 'panel:toggle-thread', threadId: el.dataset.threadId, source: eventSource() });
      });
    });
    panel.querySelectorAll('.thread-action').forEach(function(el) {
      bindActivate(el, function() {
        vscode.postMessage({ type: 'panel:invoke-thread-command', commandId: el.dataset.commandId, threadId: el.dataset.threadId, source: eventSource() });
      });
    });
    // Reply/Cancel buttons inside composer
    panel.querySelectorAll('.reply-btn').forEach(function(el) {
      bindActivate(el, function() {
        submitComposerReply(el, eventSource());
      });
    });
    panel.querySelectorAll('.composer-box').forEach(function(el) {
      el.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          lastSource = 'keyboard';
          submitComposerReply(el, 'keyboard');
        }
      });
    });
    panel.querySelectorAll('.cancel-btn').forEach(function(el) {
      bindActivate(el, function() {
        var composer = el.closest('.composer');
        if (composer) {
          var textarea = composer.querySelector('.composer-box');
          if (textarea) textarea.value = '';
        }
      });
    });
  }

  function submitComposerReply(el, source) {
    var composer = el.closest('.composer');
    var textarea = composer ? composer.querySelector('.composer-box') : null;
    var body = textarea ? textarea.value.trim() : '';
    vscode.postMessage({ type: 'panel:submit-reply', threadId: el.dataset.threadId, body: body, source: source });
  }

  function bindStaticEvents() {
    var clearButton = document.getElementById('btn-clear');
    if (clearButton) clearButton.addEventListener('click', function() {
      vscode.postMessage({ type: 'panel:clear-filters', source: 'mouse' });
    });
    var refreshButton = document.getElementById('btn-refresh');
    if (refreshButton) refreshButton.addEventListener('click', function() {
      vscode.postMessage({ type: 'panel:invoke-global-command', commandId: 'accordo.commentsPanel.refresh', source: 'mouse' });
    });
    // Status view buttons (Open / Resolved / Total)
    document.querySelectorAll('[data-status-view]').forEach(function(el) {
      el.addEventListener('click', function() {
        var value = el.dataset.statusView;
        var status = value === 'open' || value === 'resolved' ? value : undefined;
        vscode.postMessage({ type: 'panel:set-status-filter', status: status, source: eventSource() });
      });
    });
    // Group mode chips (By file / Activity)
    document.querySelectorAll('[data-group]').forEach(function(el) {
      el.addEventListener('click', function() {
        var mode = el.dataset.group;
        if (mode === 'by-file' || mode === 'by-activity') {
          vscode.postMessage({ type: 'panel:set-group-mode', groupMode: mode, source: eventSource() });
        }
      });
    });
    // Author filter chips (Mine / Agent)
    document.querySelectorAll('[data-author]').forEach(function(el) {
      el.addEventListener('click', function() {
        var author = el.dataset.author;
        var kind = author === 'user' || author === 'agent' ? author : undefined;
        vscode.postMessage({ type: 'panel:set-author-filter', authorKind: kind, source: eventSource() });
      });
    });
    if (searchInput) searchInput.addEventListener('input', function() {
      vscode.postMessage({ type: 'panel:set-search-query', query: searchInput.value, source: 'keyboard' });
    });
  }

  var lastSource = 'mouse';
  function bindActivate(el, fn) {
    el.addEventListener('click', function() { lastSource = 'mouse'; fn(); });
    el.addEventListener('keydown', function(e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); lastSource = 'keyboard'; fn(); } });
  }
  function eventSource() { return lastSource; }
  function updateStatusButtons(status) {
    openCount.classList.toggle('active', status === 'open');
    resolvedCount.classList.toggle('active', status === 'resolved');
    totalCount.classList.toggle('active', status !== 'open' && status !== 'resolved');
  }
  function updateGroupButtons(groupMode) {
    var byFile = document.getElementById('chip-by-file');
    var byActivity = document.getElementById('chip-by-activity');
    if (byFile) byFile.classList.toggle('active', groupMode === 'by-file');
    if (byActivity) byActivity.classList.toggle('active', groupMode === 'by-activity');
  }
  function escHtml(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  bindStaticEvents();
  window.addEventListener('message', function(event) {
    if (event.data && event.data.type === 'panel:state') renderPanel(event.data.model);
  });
  vscode.postMessage({ type: 'panel:ready', apiVersion: '1' });
})();`;
}
