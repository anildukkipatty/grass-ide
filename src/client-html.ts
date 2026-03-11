export const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />
<title>grass client</title>
<style>
  :root {
    --bg: #f5f5f5;
    --text: #1a1a1a;
    --bar-bg: #e8e8e8;
    --border: #d0d0d0;
    --msg-user-bg: #0066cc;
    --msg-user-text: #fff;
    --msg-assistant-bg: #fff;
    --msg-assistant-text: #1a1a1a;
    --msg-assistant-border: #d0d0d0;
    --msg-error-bg: #fff0f0;
    --msg-error-text: #cc0000;
    --msg-error-border: #cc0000;
    --input-bg: #fff;
    --input-text: #1a1a1a;
    --accent: #0066cc;
    --accent-hover: #0052a3;
    --badge-text: #888;
    --toggle-text: #666;
  }
  @media (prefers-color-scheme: dark) {
    :root:not(.light) {
      --bg: #1a1a2e;
      --text: #e0e0e0;
      --bar-bg: #16213e;
      --border: #0f3460;
      --msg-user-bg: #0f3460;
      --msg-user-text: #e0e0e0;
      --msg-assistant-bg: #16213e;
      --msg-assistant-text: #e0e0e0;
      --msg-assistant-border: #0f3460;
      --msg-error-bg: #3c1414;
      --msg-error-text: #e74c3c;
      --msg-error-border: #e74c3c;
      --input-bg: #1a1a2e;
      --input-text: #e0e0e0;
      --accent: #533483;
      --accent-hover: #6c44a2;
      --badge-text: #888;
      --toggle-text: #aaa;
    }
  }
  :root.dark {
    --bg: #1a1a2e;
    --text: #e0e0e0;
    --bar-bg: #16213e;
    --border: #0f3460;
    --msg-user-bg: #0f3460;
    --msg-user-text: #e0e0e0;
    --msg-assistant-bg: #16213e;
    --msg-assistant-text: #e0e0e0;
    --msg-assistant-border: #0f3460;
    --msg-error-bg: #3c1414;
    --msg-error-text: #e74c3c;
    --msg-error-border: #e74c3c;
    --input-bg: #1a1a2e;
    --input-text: #e0e0e0;
    --accent: #533483;
    --accent-hover: #6c44a2;
    --badge-text: #888;
    --toggle-text: #aaa;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; touch-action: pan-x pan-y; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
    height: 100vh;
    height: 100dvh;
    display: flex;
    flex-direction: column;
  }
  /* Status bar — mobile-first */
  #status-bar {
    padding: 12px 16px;
    padding-top: calc(12px + env(safe-area-inset-top, 0px));
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
    font-size: 13px;
    background: var(--bar-bg);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .new-chat-btn {
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 4px;
    line-height: 1;
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.75;
    transition: opacity 0.15s;
  }
  .new-chat-btn:hover { opacity: 1; }
  .new-chat-btn:active { opacity: 0.7; transform: scale(0.9); }
  .new-chat-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .new-chat-btn svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .theme-toggle {
    background: none;
    border: none;
    color: var(--text);
    cursor: pointer;
    padding: 4px;
    line-height: 1;
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0.75;
    transition: opacity 0.15s;
  }
  .theme-toggle:hover { opacity: 1; }
  .theme-toggle:active { opacity: 0.7; transform: scale(0.9); }
  .theme-toggle svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  /* Messages area */
  #messages {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    padding: 12px;
    padding-left: calc(12px + env(safe-area-inset-left, 0px));
    padding-right: calc(12px + env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .msg {
    max-width: 90%;
    padding: 12px 16px;
    border-radius: 16px;
    line-height: 1.5;
    word-wrap: break-word;
    overflow-wrap: break-word;
    font-size: 15px;
  }
  .msg.user {
    align-self: flex-end;
    background: var(--msg-user-bg);
    color: var(--msg-user-text);
    border-radius: 16px 16px 4px 16px;
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--msg-assistant-bg);
    color: var(--msg-assistant-text);
    border: 1px solid var(--msg-assistant-border);
    border-radius: 16px 16px 16px 4px;
  }
  .msg.error {
    align-self: center;
    background: var(--msg-error-bg);
    color: var(--msg-error-text);
    border: 1px solid var(--msg-error-border);
    font-size: 14px;
    border-radius: 12px;
  }
  .badge {
    font-size: 11px;
    color: var(--badge-text);
    margin-top: 4px;
  }
  /* Input bar — mobile-first */
  #input-bar {
    padding: 10px 12px;
    padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    padding-left: calc(12px + env(safe-area-inset-left, 0px));
    padding-right: calc(12px + env(safe-area-inset-right, 0px));
    background: var(--bar-bg);
    border-top: 1px solid var(--border);
    display: flex;
    align-items: flex-end;
    gap: 8px;
  }
  #input-bar textarea {
    flex: 1;
    background: var(--input-bg);
    color: var(--input-text);
    border: 1px solid var(--border);
    border-radius: 20px;
    padding: 12px 16px;
    font-size: 16px;
    font-family: inherit;
    resize: none;
    outline: none;
    min-height: 48px;
    max-height: 120px;
    overflow-y: auto;
  }
  #input-bar textarea:focus { border-color: var(--accent); }
  #input-bar textarea:disabled { opacity: 0.5; }
  #input-bar button {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 50%;
    width: 48px;
    height: 48px;
    min-width: 48px;
    min-height: 48px;
    font-size: 20px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    flex-shrink: 0;
  }
  #input-bar button:hover { background: var(--accent-hover); }
  #input-bar button:active { opacity: 0.8; transform: scale(0.93); }
  #input-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
  #input-bar button.abort {
    background: #e74c3c;
  }
  #input-bar button.abort:hover {
    background: #c0392b;
  }
  /* Activity bar */
  .activity-bar {
    padding: 8px 16px;
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    font-size: 13px;
    color: var(--badge-text);
    background: var(--bar-bg);
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 32px;
  }
  .activity-bar .dot-pulse {
    display: inline-flex;
    gap: 3px;
    align-items: center;
  }
  .activity-bar .dot-pulse span {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  .activity-bar .dot-pulse span:nth-child(2) { animation-delay: 0.2s; }
  .activity-bar .dot-pulse span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes pulse {
    0%, 80%, 100% { opacity: 0.2; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1); }
  }
  /* Permission modal */
  .permission-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: 16px;
  }
  .permission-card {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: 20px;
    max-width: 500px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .permission-card h3 {
    font-size: 16px;
    font-weight: 600;
  }
  .permission-card .tool-name {
    font-size: 13px;
    color: var(--badge-text);
  }
  .permission-body {
    overflow: auto;
    max-height: 300px;
    font-size: 13px;
  }
  .permission-body .md-content pre {
    margin: 8px 0;
    border-radius: 8px;
    overflow-x: auto;
    background: #1e1e2e;
    border: 1px solid var(--border);
  }
  .permission-body .md-content pre code {
    display: block;
    padding: 12px;
    background: none;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre;
    border-radius: 0;
  }
  .permission-body .md-content code {
    font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.88em;
    background: rgba(0,0,0,0.08);
    padding: 2px 5px;
    border-radius: 4px;
  }
  .permission-body .md-content p { margin: 0 0 8px 0; }
  .permission-body .md-content p:last-child { margin-bottom: 0; }
  .permission-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .permission-actions button {
    padding: 8px 20px;
    border-radius: 8px;
    border: 1px solid var(--border);
    font-size: 14px;
    cursor: pointer;
    font-family: inherit;
  }
  .permission-actions .allow-btn {
    background: #2ecc71;
    color: #fff;
    border-color: #2ecc71;
  }
  .permission-actions .allow-btn:hover { background: #27ae60; }
  .permission-actions .deny-btn {
    background: none;
    color: var(--text);
  }
  .permission-actions .deny-btn:hover { background: var(--border); }
  /* Workspace picker */
  .workspace-picker {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
  }
  .workspace-picker-header {
    padding: 16px;
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .workspace-picker-header h2 {
    font-size: 18px;
    font-weight: 600;
    flex: 1;
  }
  .repo-list {
    list-style: none;
    padding: 0 16px 8px;
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .repo-item {
    padding: 14px 16px;
    background: var(--msg-assistant-bg);
    border: 1px solid var(--msg-assistant-border);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .repo-item:hover { background: var(--bar-bg); }
  .repo-item:active { opacity: 0.7; transform: scale(0.98); }
  .repo-item-name {
    font-size: 15px;
    font-weight: 500;
    flex: 1;
  }
  .repo-item-badge {
    font-size: 11px;
    padding: 2px 7px;
    border-radius: 10px;
    background: rgba(46,160,67,0.15);
    color: #3fb950;
    border: 1px solid rgba(46,160,67,0.3);
    flex-shrink: 0;
  }
  .repo-item-badge.non-git {
    background: rgba(0,0,0,0.06);
    color: var(--badge-text);
    border-color: var(--border);
  }
  .clone-section {
    padding: 12px 16px 16px;
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
    border-top: 1px solid var(--border);
    margin-top: 4px;
  }
  .clone-section h3 {
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 10px;
    color: var(--badge-text);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .clone-input-row {
    display: flex;
    gap: 8px;
  }
  .clone-input-row input {
    flex: 1;
    background: var(--input-bg);
    color: var(--input-text);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px 14px;
    font-size: 14px;
    font-family: inherit;
    outline: none;
    min-height: 44px;
  }
  .clone-input-row input:focus { border-color: var(--accent); }
  .clone-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 10px 18px;
    border-radius: 10px;
    font-family: inherit;
    min-height: 44px;
    white-space: nowrap;
  }
  .clone-btn:hover { background: var(--accent-hover); }
  .clone-btn:active { opacity: 0.8; transform: scale(0.96); }
  .clone-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .clone-status {
    margin-top: 8px;
    font-size: 13px;
    color: var(--badge-text);
  }
  .clone-error {
    margin-top: 8px;
    font-size: 13px;
    color: var(--msg-error-text);
  }
  .workspace-empty {
    padding: 40px 16px;
    text-align: center;
    color: var(--badge-text);
    font-size: 15px;
  }
  /* Session picker */
  .session-picker {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
  }
  .session-picker-header {
    padding: 16px;
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .session-picker-header h2 {
    font-size: 18px;
    font-weight: 600;
    flex: 1;
  }
  .session-picker-new-btn {
    background: var(--accent);
    color: #fff;
    border: none;
    font-size: 14px;
    cursor: pointer;
    padding: 10px 20px;
    border-radius: 10px;
    font-family: inherit;
    min-height: 44px;
  }
  .session-picker-new-btn:hover { background: var(--accent-hover); }
  .session-picker-new-btn:active { opacity: 0.8; transform: scale(0.96); }
  .session-list {
    list-style: none;
    padding: 0 16px 16px;
    padding-left: calc(16px + env(safe-area-inset-left, 0px));
    padding-right: calc(16px + env(safe-area-inset-right, 0px));
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .session-item {
    padding: 14px 16px;
    background: var(--msg-assistant-bg);
    border: 1px solid var(--msg-assistant-border);
    border-radius: 12px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .session-item:hover { background: var(--bar-bg); }
  .session-item:active { opacity: 0.7; transform: scale(0.98); }
  .session-item-preview {
    font-size: 14px;
    line-height: 1.4;
    word-break: break-word;
  }
  .session-item-meta {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-top: 4px;
  }
  .session-item-time {
    font-size: 11px;
    color: var(--badge-text);
    white-space: nowrap;
  }
  .session-item-id {
    font-size: 11px;
    font-family: monospace;
    color: var(--badge-text);
    word-break: break-all;
    opacity: 0.6;
  }
  .session-empty {
    padding: 40px 16px;
    text-align: center;
    color: var(--badge-text);
    font-size: 15px;
  }
  .sessions-btn {
    margin-left: auto;
    background: none;
    border: 1px solid var(--border);
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
    padding: 6px 14px;
    border-radius: 8px;
    line-height: 1.4;
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .sessions-btn:hover { background: var(--border); }
  .sessions-btn:active { opacity: 0.7; transform: scale(0.96); }
  /* Diff view */
  .diff-view {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    display: flex;
    flex-direction: column;
    padding-top: 12px;
  }
  .diff-file {
    margin: 0 16px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: clip;
  }
  .diff-table-scroll {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .diff-file-header {
    background: var(--bar-bg);
    border-bottom: 1px solid var(--border);
    padding: 8px 12px;
    font-size: 13px;
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-weight: 600;
  }
  .diff-table {
    min-width: 100%;
    border-collapse: collapse;
    font-family: "SF Mono", "Fira Code", Menlo, Consolas, monospace;
    font-size: 12px;
    line-height: 1.5;
  }
  .diff-table td { padding: 0 8px; white-space: pre; }
  .diff-line-num {
    width: 1px;
    text-align: right;
    color: var(--badge-text);
    user-select: none;
    padding: 0 6px !important;
    opacity: 0.6;
  }
  .diff-line-add { background: rgba(46,160,67,0.15); }
  .diff-line-add td:last-child { color: #3fb950; }
  .diff-line-del { background: rgba(248,81,73,0.15); }
  .diff-line-del td:last-child { color: #f85149; }
  .diff-line-hunk { background: rgba(56,139,253,0.1); }
  .diff-line-hunk td { color: var(--badge-text); font-style: italic; }
  .diff-empty {
    padding: 40px 16px;
    text-align: center;
    color: var(--badge-text);
    font-size: 15px;
  }
  /* Markdown content inside messages */
  .msg .md-content { white-space: normal; }
  .msg .md-content p { margin: 0 0 8px 0; }
  .msg .md-content p:last-child { margin-bottom: 0; }
  .msg .md-content h1, .msg .md-content h2, .msg .md-content h3,
  .msg .md-content h4, .msg .md-content h5, .msg .md-content h6 {
    margin: 12px 0 6px 0;
    line-height: 1.3;
  }
  .msg .md-content h1:first-child, .msg .md-content h2:first-child,
  .msg .md-content h3:first-child { margin-top: 0; }
  .msg .md-content ul, .msg .md-content ol {
    margin: 4px 0 8px 0;
    padding-left: 20px;
  }
  .msg .md-content li { margin-bottom: 2px; }
  .msg .md-content blockquote {
    border-left: 3px solid var(--border);
    padding-left: 10px;
    margin: 6px 0;
    opacity: 0.85;
  }
  .msg .md-content code {
    font-family: "SF Mono", "Fira Code", "Fira Mono", Menlo, Consolas, monospace;
    font-size: 0.88em;
    background: rgba(0,0,0,0.08);
    padding: 2px 5px;
    border-radius: 4px;
  }
  .msg.user .md-content code {
    background: rgba(255,255,255,0.15);
  }
  .msg .md-content pre {
    margin: 8px 0;
    border-radius: 8px;
    overflow-x: auto;
    background: #1e1e2e;
    border: 1px solid var(--border);
  }
  .msg .md-content pre code {
    display: block;
    padding: 12px;
    background: none;
    font-size: 13px;
    line-height: 1.5;
    white-space: pre;
    border-radius: 0;
  }
  .msg .md-content a {
    color: var(--accent);
    text-decoration: underline;
  }
  .msg.user .md-content a { color: #aad4ff; }
  .msg .md-content table {
    border-collapse: collapse;
    margin: 8px 0;
    font-size: 0.9em;
    width: 100%;
  }
  .msg .md-content th, .msg .md-content td {
    border: 1px solid var(--border);
    padding: 6px 10px;
    text-align: left;
  }
  .msg .md-content th { background: rgba(0,0,0,0.05); font-weight: 600; }
  .msg .md-content hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 10px 0;
  }
  .msg .md-content img { max-width: 100%; border-radius: 6px; }
  /* highlight.js — inline github-dark colors */
  .md-content pre code.hljs { background: none; padding: 12px; color: #c9d1d9; }
  .md-content pre code .hljs-keyword,
  .md-content pre code .hljs-selector-tag,
  .md-content pre code .hljs-literal,
  .md-content pre code .hljs-section,
  .md-content pre code .hljs-link { color: #ff7b72; }
  .md-content pre code .hljs-string,
  .md-content pre code .hljs-regexp { color: #a5d6ff; }
  .md-content pre code .hljs-title,
  .md-content pre code .hljs-type,
  .md-content pre code .hljs-built_in,
  .md-content pre code .hljs-selector-id,
  .md-content pre code .hljs-selector-class { color: #d2a8ff; }
  .md-content pre code .hljs-attr,
  .md-content pre code .hljs-variable,
  .md-content pre code .hljs-template-variable,
  .md-content pre code .hljs-number,
  .md-content pre code .hljs-meta { color: #79c0ff; }
  .md-content pre code .hljs-comment,
  .md-content pre code .hljs-quote { color: #8b949e; }
  .md-content pre code .hljs-name { color: #7ee787; }
  .md-content pre code .hljs-subst { color: #c9d1d9; }
  /* Diff highlighting */
  .md-content pre code .hljs-addition { color: #3fb950; background: rgba(46,160,67,0.15); display: inline-block; width: 100%; }
  .md-content pre code .hljs-deletion { color: #f85149; background: rgba(248,81,73,0.15); display: inline-block; width: 100%; }
  .md-content pre code.language-diff .hljs-meta { color: #79c0ff; font-weight: 600; }
  /* Desktop overrides */
  @media (min-width: 768px) {
    #status-bar { padding: 8px 16px; font-size: 12px; }
    .new-chat-btn { min-height: 32px; min-width: 32px; }
    .new-chat-btn svg { width: 16px; height: 16px; }
    .theme-toggle { min-height: 32px; min-width: 32px; }
    .theme-toggle svg { width: 16px; height: 16px; }
    #messages { padding: 16px; gap: 12px; }
    .msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; font-size: 14px; }
    .msg.user { border-radius: 12px 12px 4px 12px; }
    .msg.assistant { border-radius: 12px 12px 12px 4px; }
    .msg.error { font-size: 13px; }
    #input-bar { padding: 12px 16px; }
    #input-bar textarea { font-size: 14px; min-height: 42px; border-radius: 8px; padding: 10px 12px; }
    #input-bar button { border-radius: 8px; width: auto; height: auto; min-width: unset; min-height: unset; padding: 0 20px; font-size: 14px; }
    .activity-bar { padding: 6px 16px; font-size: 12px; min-height: 28px; }
    .activity-bar .dot-pulse span { width: 4px; height: 4px; }
    .session-picker-header { padding: 12px 16px; }
    .session-picker-header h2 { font-size: 16px; }
    .session-picker-new-btn { font-size: 12px; padding: 6px 14px; min-height: 32px; }
    .session-list { padding: 0 16px 16px; gap: 4px; }
    .session-item { padding: 10px 14px; border-radius: 8px; }
    .session-item-preview { font-size: 13px; }
    .session-item-id { font-size: 10px; }
    .sessions-btn { font-size: 11px; padding: 4px 10px; min-height: 32px; }
    .workspace-picker-header { padding: 12px 16px; }
    .workspace-picker-header h2 { font-size: 16px; }
    .repo-list { padding: 0 16px 8px; gap: 4px; }
    .repo-item { padding: 10px 14px; border-radius: 8px; }
    .repo-item-name { font-size: 14px; }
    .clone-section { padding: 10px 16px 14px; }
    .clone-input-row input { font-size: 13px; min-height: 36px; }
    .clone-btn { font-size: 13px; min-height: 36px; padding: 8px 14px; }
  }
</style>
</head>
<body>
<div id="status-bar">
  <span id="status-text">Connecting...</span>
</div>
<div id="messages"></div>
<div id="input-bar">
  <textarea id="input" placeholder="Type a message..." rows="1" disabled></textarea>
  <button id="send" disabled>Send</button>
</div>

<script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/marked/lib/marked.umd.js"></script>
<script src="https://cdn.jsdelivr.net/npm/marked-highlight/lib/index.umd.js"></script>
<script src="https://unpkg.com/@highlightjs/cdn-assets/highlight.min.js"></script>

<script type="text/babel">
const { useState, useEffect, useRef, useCallback, useMemo } = React;

// Configure marked with highlight.js for code syntax highlighting
const { Marked } = globalThis.marked;
const { markedHighlight } = globalThis.markedHighlight;

const markedInstance = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang, info) {
      if (!lang && /^(diff --git|---\\s|\\+\\+\\+\\s|@@\\s)/m.test(code)) {
        lang = "diff";
      }
      if (lang && hljs.getLanguage(lang)) {
        try { return hljs.highlight(code, { language: lang }).value; } catch {}
      }
      try { return hljs.highlightAuto(code).value; } catch {}
      return code;
    },
  })
);
markedInstance.setOptions({ breaks: true, gfm: true });

function renderMarkdown(text) {
  if (!text) return "";
  try {
    return markedInstance.parse(text);
  } catch {
    return text;
  }
}

function MarkdownContent({ content }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return React.createElement("div", {
    className: "md-content",
    dangerouslySetInnerHTML: { __html: html },
  });
}

function timeAgo(isoString) {
  if (!isoString) return "";
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " min" + (mins === 1 ? "" : "s") + " ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + " hr" + (hrs === 1 ? "" : "s") + " ago";
  const days = Math.floor(hrs / 24);
  if (days < 30) return days + " day" + (days === 1 ? "" : "s") + " ago";
  const months = Math.floor(days / 30);
  if (months < 12) return months + " month" + (months === 1 ? "" : "s") + " ago";
  const years = Math.floor(months / 12);
  return years + " year" + (years === 1 ? "" : "s") + " ago";
}

function formatPermissionInput(toolName, input) {
  switch (toolName) {
    case "Write":
      return "**File:** \`" + input.file_path + "\`\\n\\nContent (" + (input.content || "").length + " chars):\\n\\n\`\`\`\\n" + (input.content || "").slice(0, 500) + ((input.content || "").length > 500 ? "\\n..." : "") + "\\n\`\`\`";
    case "Edit":
      return "**File:** \`" + input.file_path + "\`\\n\\n**Replace:**\\n\`\`\`\\n" + (input.old_string || "").slice(0, 300) + "\\n\`\`\`\\n\\n**With:**\\n\`\`\`\\n" + (input.new_string || "").slice(0, 300) + "\\n\`\`\`";
    case "Bash":
      return "**Command:**\\n\`\`\`bash\\n" + (input.command || "") + "\\n\`\`\`";
    default:
      return "\`\`\`json\\n" + JSON.stringify(input, null, 2) + "\\n\`\`\`";
  }
}

function parseDiff(raw) {
  if (!raw || !raw.trim()) return [];
  const files = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);
  for (const section of fileSections) {
    const lines = section.split("\\n");
    const headerMatch = lines[0].match(/a\\/(.*?)\\s+b\\/(.*)/);
    const filename = headerMatch ? headerMatch[2] : lines[0];
    const parsedLines = [];
    let oldLine = 0, newLine = 0;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith("@@")) {
        const hunkMatch = line.match(/@@ -(\\d+)(?:,\\d+)? \\+(\\d+)(?:,\\d+)? @@/);
        if (hunkMatch) {
          oldLine = parseInt(hunkMatch[1], 10);
          newLine = parseInt(hunkMatch[2], 10);
        }
        parsedLines.push({ type: "hunk", content: line, oldNum: "", newNum: "" });
      } else if (line.startsWith("+")) {
        parsedLines.push({ type: "add", content: line.slice(1), oldNum: "", newNum: newLine });
        newLine++;
      } else if (line.startsWith("-")) {
        parsedLines.push({ type: "del", content: line.slice(1), oldNum: oldLine, newNum: "" });
        oldLine++;
      } else if (line.startsWith(" ")) {
        parsedLines.push({ type: "ctx", content: line.slice(1), oldNum: oldLine, newNum: newLine });
        oldLine++;
        newLine++;
      } else if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("index ") || line.startsWith("new file") || line.startsWith("deleted file") || line.startsWith("old mode") || line.startsWith("new mode") || line.startsWith("similarity") || line.startsWith("rename") || line.startsWith("Binary")) {
        // skip meta lines
      }
    }
    if (parsedLines.length > 0) {
      files.push({ filename, lines: parsedLines });
    }
  }
  return files;
}

function getExtFromFilename(filename) {
  const ext = filename.split(".").pop();
  const map = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", rb: "ruby", rs: "rust", go: "go", java: "java", json: "json", md: "markdown", css: "css", html: "xml", yml: "yaml", yaml: "yaml", sh: "bash", bash: "bash", zsh: "bash" };
  return map[ext] || ext;
}

function DiffView({ files, onBack }) {
  return React.createElement(React.Fragment, null,
    React.createElement("div", { id: "status-bar" },
      React.createElement("button", { className: "new-chat-btn", onClick: onBack }, "\\u2190 Back"),
      React.createElement("span", { style: { fontWeight: 600 } }, "Diffs"),
      React.createElement("span", { style: { marginLeft: "auto", fontSize: 12, color: "var(--badge-text)" } }, files.length + " file" + (files.length !== 1 ? "s" : ""))
    ),
    React.createElement("div", { className: "diff-view" },
      files.length === 0
        ? React.createElement("div", { className: "diff-empty" }, "No changes detected")
        : files.map((file, fi) => {
            const lang = getExtFromFilename(file.filename);
            return React.createElement("div", { key: fi, className: "diff-file" },
              React.createElement("div", { className: "diff-file-header" }, file.filename),
              React.createElement("div", { className: "diff-table-scroll" },
              React.createElement("table", { className: "diff-table" },
                React.createElement("tbody", null,
                  file.lines.map((ln, li) => {
                    const cls = ln.type === "add" ? "diff-line-add" : ln.type === "del" ? "diff-line-del" : ln.type === "hunk" ? "diff-line-hunk" : "";
                    let highlighted = ln.content;
                    if (ln.type !== "hunk" && lang && typeof hljs !== "undefined" && hljs.getLanguage(lang)) {
                      try { highlighted = hljs.highlight(ln.content, { language: lang }).value; } catch {}
                    }
                    const prefix = ln.type === "add" ? "+" : ln.type === "del" ? "-" : " ";
                    return React.createElement("tr", { key: li, className: cls },
                      React.createElement("td", { className: "diff-line-num" }, ln.oldNum),
                      React.createElement("td", { className: "diff-line-num" }, ln.newNum),
                      React.createElement("td", { dangerouslySetInnerHTML: { __html: (ln.type === "hunk" ? ln.content : prefix + highlighted) } })
                    );
                  })
                )
              )
              )
            );
          })
    )
  );
}

// Simple API client
const api = {
  async get(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = "Request failed";
      try { msg = (await r.json()).error || msg; } catch {}
      throw new Error(msg);
    }
    return r.json();
  },
};

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [serverReachable, setServerReachable] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "light");
  const [permissionQueue, setPermissionQueue] = useState([]);
  const [view, setView] = useState("workspace");
  const [sessionsList, setSessionsList] = useState([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [diffFiles, setDiffFiles] = useState([]);
  // Workspace state
  const [repos, setRepos] = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneError, setCloneError] = useState(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [createError, setCreateError] = useState(null);

  const esRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme(t => t === "light" ? "dark" : "light");
  }, []);

  // On mount: ping server to check reachability and load repos
  useEffect(() => {
    api.get("/agents")
      .then(() => {
        setServerReachable(true);
        setLoadingRepos(true);
        return api.get("/repos");
      })
      .then(data => {
        setRepos(data.repos || []);
        setLoadingRepos(false);
      })
      .catch(() => {
        setServerReachable(false);
      });
  }, []);

  const closeEventSource = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const openEventSource = useCallback((sid) => {
    closeEventSource();
    const es = new EventSource("/events?sessionId=" + encodeURIComponent(sid));
    esRef.current = es;

    es.addEventListener("assistant", (e) => {
      const data = JSON.parse(e.data);
      setActivity(null);
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === "assistant" && !last.complete) {
          return [...prev.slice(0, -1), { ...last, content: data.content }];
        }
        return [...prev, { role: "assistant", content: data.content, complete: false }];
      });
    });

    es.addEventListener("status", (e) => {
      const data = JSON.parse(e.data);
      if (data.status === "thinking") {
        setActivity({ label: "Thinking" });
      } else if (data.status === "tool") {
        const elapsed = data.elapsed != null ? Math.round(data.elapsed) + "s" : "";
        setActivity({ label: data.tool_name + (elapsed ? " (" + elapsed + ")" : "") });
      } else if (data.status === "tool_summary") {
        setActivity({ label: data.summary });
      } else {
        setActivity(null);
      }
    });

    es.addEventListener("tool_use", (e) => {
      const data = JSON.parse(e.data);
      setActivity({ label: data.tool_name + ": " + data.tool_input });
    });

    es.addEventListener("permission_request", (e) => {
      const data = JSON.parse(e.data);
      setPermissionQueue(prev => {
        if (prev.some(p => p.toolUseID === data.toolUseID)) return prev;
        return [...prev, { toolUseID: data.toolUseID, toolName: data.toolName, input: data.input }];
      });
    });

    es.addEventListener("result", (e) => {
      const data = JSON.parse(e.data);
      setStreaming(false);
      setActivity(null);
      setMessages(prev => {
        const cost = data.cost != null ? "$" + data.cost.toFixed(4) : null;
        const duration = data.duration_ms != null ? (data.duration_ms / 1000).toFixed(1) + "s" : null;
        const badge = [cost, duration].filter(Boolean).join(" \\u00B7 ");
        const lastIdx = prev.length - 1;
        return prev.map((msg, i) =>
          msg.role === "assistant" && !msg.complete
            ? { ...msg, complete: true, ...(i === lastIdx ? { badge } : {}) }
            : msg
        );
      });
      setTimeout(() => textareaRef.current?.focus(), 0);
    });

    es.addEventListener("aborted", (e) => {
      const data = JSON.parse(e.data);
      setStreaming(false);
      setActivity(null);
      setMessages(prev => [...prev, { role: "error", content: "\\u26A0\\uFE0F " + data.message }]);
    });

    const handleErrorEvent = (e) => {
      if (!e.data) return;
      try {
        const data = JSON.parse(e.data);
        setStreaming(false);
        setActivity(null);
        setMessages(prev => [...prev, { role: "error", content: data.message }]);
      } catch {}
    };
    es.addEventListener("error_event", handleErrorEvent);
    es.addEventListener("error", handleErrorEvent);
    es.addEventListener("agent_error", handleErrorEvent);

    es.addEventListener("done", () => {
      es.close();
      esRef.current = null;
      setStreaming(false);
      setActivity(null);
      setMessages(prev =>
        prev.map(msg =>
          msg.role === "assistant" && !msg.complete
            ? { ...msg, complete: true }
            : msg
        )
      );
      setTimeout(() => textareaRef.current?.focus(), 0);
    });

    es.onerror = () => {
      // EventSource auto-reconnects with Last-Event-ID; nothing to do
    };
  }, [closeEventSource]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !serverReachable || streaming) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setStreaming(true);
    setActivity({ label: "Thinking" });

    try {
      const result = await api.post("/chat", {
        repoPath: selectedRepo?.path,
        agent: selectedAgent,
        prompt: text,
        sessionId: sessionId || undefined,
      });
      const sid = result.sessionId;
      setSessionId(sid);
      openEventSource(sid);
    } catch (err) {
      setStreaming(false);
      setActivity(null);
      setMessages(prev => [...prev, { role: "error", content: err.message }]);
    }
  }, [input, serverReachable, streaming, selectedRepo, selectedAgent, sessionId, openEventSource]);

  const abort = useCallback(async () => {
    if (!streaming || !sessionId) return;
    setPermissionQueue([]);
    try {
      await api.post("/sessions/" + sessionId + "/abort", {});
    } catch {}
  }, [streaming, sessionId]);

  const newChat = useCallback(() => {
    closeEventSource();
    setSessionId(null);
    setMessages([]);
    setActivity(null);
    setStreaming(false);
    setPermissionQueue([]);
    setView("chat");
  }, [closeEventSource]);

  const selectSession = useCallback(async (id) => {
    closeEventSource();
    setSessionId(id);
    setMessages([]);
    setActivity(null);
    setStreaming(false);
    setPermissionQueue([]);
    setView("chat");

    try {
      const data = await api.get("/sessions/" + id + "/history?agent=" + (selectedAgent || "") + "&repoPath=" + encodeURIComponent(selectedRepo?.path || ""));
      if (data.messages && data.messages.length > 0) {
        setMessages(data.messages.map((m, i) => ({
          role: m.role,
          content: m.content,
          complete: true,
          msgId: "history-" + i,
        })));
      }
      // Check if session is still streaming
      const status = await api.get("/sessions/" + id + "/status");
      if (status.streaming) {
        setStreaming(true);
        openEventSource(id);
      }
    } catch {}
  }, [closeEventSource, selectedAgent, selectedRepo, openEventSource]);

  const showWorkspace = useCallback(() => {
    setView("workspace");
    setLoadingRepos(true);
    api.get("/repos").then(data => {
      setRepos(data.repos || []);
      setLoadingRepos(false);
    }).catch(() => setLoadingRepos(false));
  }, []);

  const handleSelectRepo = useCallback((repo) => {
    setSelectedRepo({ path: repo.path, name: repo.name });
    setSelectedAgent(null);
    setView("agent_picker");
  }, []);

  const handleSelectAgent = useCallback(async (agent) => {
    setSelectedAgent(agent);
    setLoadingSessions(true);
    setView("picker");
    try {
      const data = await api.get("/sessions?agent=" + agent + "&repoPath=" + encodeURIComponent(selectedRepo?.path || ""));
      setSessionsList(data.sessions || []);
    } catch {
      setSessionsList([]);
    }
    setLoadingSessions(false);
  }, [selectedRepo]);

  const handleClone = useCallback(async () => {
    const url = cloneUrl.trim();
    if (!url || cloning) return;
    setCloning(true);
    setCloneError(null);
    try {
      const data = await api.post("/repos/clone", { url });
      setSelectedRepo({ path: data.path, name: data.name });
      setCloning(false);
      setCloneUrl("");
      setSelectedAgent(null);
      setView("agent_picker");
    } catch (err) {
      setCloning(false);
      setCloneError(err.message);
    }
  }, [cloneUrl, cloning]);

  const handleCreateFolder = useCallback(async () => {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    setCreateError(null);
    try {
      const data = await api.post("/folders", { name });
      setSelectedRepo({ path: data.path, name: data.name });
      setCreatingFolder(false);
      setNewFolderName("");
      setRepos(prev => [...prev, { path: data.path, name: data.name, isGit: false }]);
      setSelectedAgent(null);
      setView("agent_picker");
    } catch (err) {
      setCreatingFolder(false);
      setCreateError(err.message);
    }
  }, [newFolderName, creatingFolder]);

  const showPicker = useCallback(async () => {
    setView("picker");
    setLoadingSessions(true);
    try {
      const data = await api.get("/sessions?agent=" + (selectedAgent || "") + "&repoPath=" + encodeURIComponent(selectedRepo?.path || ""));
      setSessionsList(data.sessions || []);
    } catch {
      setSessionsList([]);
    }
    setLoadingSessions(false);
  }, [selectedAgent, selectedRepo]);

  const showDiffs = useCallback(async () => {
    setView("diffs");
    try {
      const data = await api.get("/diffs?repoPath=" + encodeURIComponent(selectedRepo?.path || ""));
      setDiffFiles(parseDiff(data.diff || ""));
    } catch {
      setDiffFiles([]);
    }
  }, [selectedRepo]);

  const respondPermission = useCallback(async (approved) => {
    if (permissionQueue.length === 0 || !sessionId) return;
    const current = permissionQueue[0];
    setPermissionQueue(prev => prev.slice(1));
    try {
      await api.post("/sessions/" + sessionId + "/permission", {
        toolUseID: current.toolUseID,
        approved,
      });
    } catch {}
  }, [permissionQueue, sessionId]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const autoResize = useCallback((el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  const disabled = !serverReachable || streaming;

  const themeToggleHtml = theme === "light"
    ? '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  if (view === "diffs") {
    return React.createElement(DiffView, { files: diffFiles, onBack: () => setView("chat") });
  }

  if (view === "workspace") {
    return (
      <>
        <div id="status-bar">
          <span>{serverReachable ? "Workspace" : "Connecting..."}</span>
          <button className="theme-toggle" onClick={cycleTheme} title={"Theme: " + theme} style={{ marginLeft: "auto" }} dangerouslySetInnerHTML={{ __html: themeToggleHtml }} />
        </div>
        <div className="workspace-picker">
          <div className="workspace-picker-header">
            <h2>Pick a Repo</h2>
          </div>
          {loadingRepos ? (
            <div className="workspace-empty">Loading repos...</div>
          ) : repos.length === 0 ? (
            <div className="workspace-empty">No subdirectories found. Clone a repo below.</div>
          ) : (
            <ul className="repo-list">
              {repos.map((repo) => (
                <li key={repo.path} className="repo-item" onClick={() => handleSelectRepo(repo)}>
                  <span className="repo-item-name">{repo.name}</span>
                  <span className={"repo-item-badge" + (repo.isGit ? "" : " non-git")}>{repo.isGit ? "git" : "folder"}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="clone-section">
            <h3>Clone a Repo</h3>
            <div className="clone-input-row">
              <input
                type="text"
                placeholder="https://github.com/user/repo.git"
                value={cloneUrl}
                onChange={e => { setCloneUrl(e.target.value); setCloneError(null); }}
                onKeyDown={e => { if (e.key === "Enter") handleClone(); }}
                disabled={cloning}
              />
              <button className="clone-btn" onClick={handleClone} disabled={cloning || !cloneUrl.trim()}>
                {cloning ? "Cloning..." : "Clone"}
              </button>
            </div>
            {cloning && <div className="clone-status">Cloning repository, please wait...</div>}
            {cloneError && <div className="clone-error">{cloneError}</div>}
          </div>
          <div className="clone-section">
            <h3>New Project</h3>
            <div className="clone-input-row">
              <input
                type="text"
                placeholder="my-project"
                value={newFolderName}
                onChange={e => { setNewFolderName(e.target.value); setCreateError(null); }}
                onKeyDown={e => { if (e.key === "Enter") handleCreateFolder(); }}
                disabled={creatingFolder}
              />
              <button className="clone-btn" onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
                {creatingFolder ? "Creating..." : "Create"}
              </button>
            </div>
            {createError && <div className="clone-error">{createError}</div>}
          </div>
        </div>
      </>
    );
  }

  if (view === "agent_picker") {
    return (
      <>
        <div id="status-bar">
          <span>{selectedRepo ? selectedRepo.name : "Workspace"}</span>
          <button className="sessions-btn" onClick={showWorkspace} style={{ marginLeft: "auto" }}>← Repos</button>
          <button className="theme-toggle" onClick={cycleTheme} title={"Theme: " + theme} dangerouslySetInnerHTML={{ __html: themeToggleHtml }} />
        </div>
        <div className="session-picker">
          <div className="session-picker-header">
            <h2>Pick an Agent</h2>
          </div>
          <ul className="repo-list">
            <li className="repo-item" onClick={() => handleSelectAgent("claude-code")}>
              <span className="repo-item-name">Claude Code</span>
              <span className="repo-item-badge">claude-code</span>
            </li>
            <li className="repo-item" onClick={() => handleSelectAgent("opencode")}>
              <span className="repo-item-name">opencode</span>
              <span className="repo-item-badge">opencode</span>
            </li>
          </ul>
        </div>
      </>
    );
  }

  if (view === "picker") {
    return (
      <>
        <div id="status-bar">
          <span>{selectedRepo ? selectedRepo.name : "Workspace"}</span>
          <button className="sessions-btn" onClick={showWorkspace} style={{ marginLeft: "auto" }}>← Repos</button>
          <button className="theme-toggle" onClick={cycleTheme} title={"Theme: " + theme} dangerouslySetInnerHTML={{ __html: themeToggleHtml }} />
        </div>
        <div className="session-picker">
          <div className="session-picker-header">
            <h2>Sessions</h2>
            <button className="session-picker-new-btn" onClick={newChat}>+ New Chat</button>
          </div>
          {loadingSessions ? (
            <div className="session-empty">Loading sessions...</div>
          ) : sessionsList.length === 0 ? (
            <div className="session-empty">No previous sessions found. Start a new chat!</div>
          ) : (
            <ul className="session-list">
              {sessionsList.map((s) => (
                <li key={s.id} className="session-item" onClick={() => selectSession(s.id)}>
                  <div className="session-item-preview">{s.preview || "Empty session"}</div>
                  <div className="session-item-meta">
                    <span className="session-item-time">{timeAgo(s.updatedAt)}</span>
                    <span className="session-item-id">{s.id}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div id="status-bar">
        <span>{streaming ? "Streaming..." : (selectedRepo ? selectedRepo.name : "Connected")}</span>
        <button className="sessions-btn" onClick={showDiffs}>Diffs</button>
        <button className="sessions-btn" onClick={showPicker} disabled={streaming}>Sessions</button>
        <button className="new-chat-btn" onClick={newChat} disabled={streaming} title="New Chat" dangerouslySetInnerHTML={{ __html: '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>' }} />
        <button className="theme-toggle" onClick={cycleTheme} title={"Theme: " + theme} dangerouslySetInnerHTML={{ __html: themeToggleHtml }} />
      </div>
      <div id="messages">
        {messages.map((msg, i) => (
          <div key={i} className={"msg " + msg.role}>
            <MarkdownContent content={msg.content} />
            {msg.badge && <div className="badge">{msg.badge}</div>}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      {activity && (
        <div className="activity-bar">
          <div className="dot-pulse"><span /><span /><span /></div>
          <span>{activity.label}</span>
        </div>
      )}
      <div id="input-bar">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => { setInput(e.target.value); autoResize(e.target); }}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={disabled}
        />
        {streaming ? (
          <button onClick={abort} className="abort" aria-label="Abort">
            \\u25A0
          </button>
        ) : (
          <button onClick={send} disabled={disabled || !input.trim()} aria-label="Send">
            \\u2191
          </button>
        )}
      </div>
      {permissionQueue.length > 0 && (
        <div className="permission-overlay">
          <div className="permission-card">
            <h3>Permission Request{permissionQueue.length > 1 ? " (1 of " + permissionQueue.length + ")" : ""}</h3>
            <div className="tool-name">Tool: {permissionQueue[0].toolName}</div>
            <div className="permission-body">
              <MarkdownContent content={formatPermissionInput(permissionQueue[0].toolName, permissionQueue[0].input)} />
            </div>
            <div className="permission-actions">
              <button className="deny-btn" onClick={() => respondPermission(false)}>Deny</button>
              <button className="allow-btn" onClick={() => respondPermission(true)}>Allow</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Remove the static HTML and render React
document.getElementById("status-bar").remove();
document.getElementById("messages").remove();
document.getElementById("input-bar").remove();

const root = ReactDOM.createRoot(document.body);
root.render(<App />);
</script>
</body>
</html>`;
