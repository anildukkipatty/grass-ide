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
  .new-chat-btn:hover { background: var(--border); }
  .new-chat-btn:active { opacity: 0.7; transform: scale(0.96); }
  .new-chat-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .theme-toggle {
    background: none;
    border: none;
    color: var(--toggle-text);
    font-size: 20px;
    cursor: pointer;
    padding: 4px;
    line-height: 1;
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .theme-toggle:active { opacity: 0.7; transform: scale(0.9); }
  .status-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #e74c3c;
    flex-shrink: 0;
  }
  .status-dot.connected { background: #2ecc71; }
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
    white-space: pre-wrap;
    word-wrap: break-word;
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
  /* Desktop overrides */
  @media (min-width: 768px) {
    #status-bar { padding: 8px 16px; font-size: 12px; }
    .new-chat-btn { font-size: 11px; padding: 4px 10px; min-height: 32px; }
    .theme-toggle { font-size: 16px; min-height: 32px; min-width: 32px; }
    .status-dot { width: 8px; height: 8px; }
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
  }
</style>
</head>
<body>
<div id="status-bar">
  <div id="status-dot" class="status-dot"></div>
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

<script type="text/babel">
const { useState, useEffect, useRef, useCallback } = React;

const SESSIONS_KEY = "grass_sessions";
const CURRENT_KEY = "grass_current_session";

function loadSessions() {
  try { return JSON.parse(localStorage.getItem(SESSIONS_KEY)) || []; } catch { return []; }
}
function saveSessions(sessions) { localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions)); }
function getCurrentSessionId() { return localStorage.getItem(CURRENT_KEY) || null; }
function setCurrentSessionId(id) {
  if (id) localStorage.setItem(CURRENT_KEY, id);
  else localStorage.removeItem(CURRENT_KEY);
}
function addOrUpdateSession(id) {
  const sessions = loadSessions();
  const now = new Date().toISOString();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx >= 0) {
    sessions[idx].updatedAt = now;
  } else {
    sessions.push({ id, label: "Chat " + (sessions.length + 1), createdAt: now, updatedAt: now });
  }
  saveSessions(sessions);
}

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [activity, setActivity] = useState(null);
  const [sessionId, setSessionId] = useState(() => getCurrentSessionId());
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "system");
  const wsRef = useRef(null);
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const pongTimeoutRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const reconnectDelayRef = useRef(1000);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    if (theme !== "system") root.classList.add(theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme(t => t === "system" ? "light" : t === "light" ? "dark" : "system");
  }, []);

  const startPing = useCallback((ws) => {
    clearInterval(pingIntervalRef.current);
    clearTimeout(pongTimeoutRef.current);

    pingIntervalRef.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
        pongTimeoutRef.current = setTimeout(() => {
          console.log("Pong timeout — closing connection");
          ws.close();
        }, 5000);
      }
    }, 30000);
  }, []);

  const stopPing = useCallback(() => {
    clearInterval(pingIntervalRef.current);
    clearTimeout(pongTimeoutRef.current);
  }, []);

  useEffect(() => {
    let connectTimeout = null;

    function connect() {
      clearTimeout(reconnectTimeoutRef.current);
      clearTimeout(connectTimeout);
      let ws = new WebSocket(\`ws://\${window.location.hostname}:3000\`);
      wsRef.current = ws;

      // If the upgrade doesn't complete within 5s, kill and retry
      connectTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.CONNECTING) {
          console.log("WebSocket connect timeout — retrying");
          ws.close();
        }
      }, 5000);

      ws.onopen = () => {
        clearTimeout(connectTimeout);
        setConnected(true);
        setReconnecting(false);
        reconnectDelayRef.current = 1000;
        startPing(ws);
        const sid = getCurrentSessionId();
        ws.send(JSON.stringify({ type: "init", sessionId: sid }));
        setTimeout(() => textareaRef.current?.focus(), 0);
      };

      ws.onclose = () => {
        clearTimeout(connectTimeout);
        setConnected(false);
        setStreaming(false);
        stopPing();
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
        reconnectTimeoutRef.current = setTimeout(() => {
          setReconnecting(true);
          connect();
        }, delay);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }

        if (data.type === "pong") {
          clearTimeout(pongTimeoutRef.current);
          return;
        }

        if (data.type === "system" && data.subtype === "init" && data.data?.session_id) {
          const sid = data.data.session_id;
          setCurrentSessionId(sid);
          addOrUpdateSession(sid);
          setSessionId(sid);
          return;
        }

        if (data.type === "history") {
          setMessages(data.messages.map((m, i) => ({
            role: m.role,
            content: m.content,
            complete: true,
            msgId: "history-" + i,
          })));
          return;
        }

        if (data.type === "assistant") {
          setActivity(null);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && !last.complete && last.msgId === data.id) {
              return [...prev.slice(0, -1), { ...last, content: data.content }];
            }
            return [...prev, { role: "assistant", content: data.content, complete: false, msgId: data.id }];
          });
        } else if (data.type === "status") {
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
        } else if (data.type === "tool_use") {
          setActivity({ label: data.tool_name + ": " + data.tool_input });
        } else if (data.type === "result") {
          setStreaming(false);
          setActivity(null);
          setMessages(prev => {
            const cost = data.cost != null ? "$" + data.cost.toFixed(4) : null;
            const duration = data.duration_ms != null ? (data.duration_ms / 1000).toFixed(1) + "s" : null;
            const badge = [cost, duration].filter(Boolean).join(" \u00B7 ");
            const lastIdx = prev.length - 1;
            return prev.map((msg, i) =>
              msg.role === "assistant" && !msg.complete
                ? { ...msg, complete: true, ...(i === lastIdx ? { badge } : {}) }
                : msg
            );
          });
          setTimeout(() => textareaRef.current?.focus(), 0);
        } else if (data.type === "aborted") {
          setStreaming(false);
          setActivity(null);
          setMessages(prev => [...prev, { role: "error", content: "\u26A0\uFE0F " + data.message }]);
        } else if (data.type === "error") {
          setStreaming(false);
          setActivity(null);
          setMessages(prev => [...prev, { role: "error", content: data.message }]);
        }
      };
    }

    connect();
    return () => {
      stopPing();
      clearTimeout(connectTimeout);
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || !connected || streaming) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    wsRef.current.send(JSON.stringify({ type: "message", content: text }));
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    setStreaming(true);
    setActivity({ label: "Thinking" });
  }, [input, connected, streaming]);

  const abort = useCallback(() => {
    if (!connected || !streaming) return;
    wsRef.current.send(JSON.stringify({ type: "abort" }));
  }, [connected, streaming]);

  const newChat = useCallback(() => {
    setCurrentSessionId(null);
    setSessionId(null);
    setMessages([]);
    setActivity(null);
    if (wsRef.current) wsRef.current.close();
  }, []);

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

  const disabled = !connected || streaming;

  return (
    <>
      <div id="status-bar">
        <div className={"status-dot" + (connected ? " connected" : "")} />
        <span>{connected ? (streaming ? "Streaming..." : "Connected") : (reconnecting ? "Reconnecting..." : "Connecting...")}</span>
        <button className="new-chat-btn" onClick={newChat} disabled={streaming}>New Chat</button>
        <button className="theme-toggle" onClick={cycleTheme} title={"Theme: " + theme}>
          {theme === "light" ? "\u2600\uFE0F" : theme === "dark" ? "\uD83C\uDF19" : "\uD83D\uDCBB"}
        </button>
      </div>
      <div id="messages">
        {messages.map((msg, i) => (
          <div key={i} className={"msg " + msg.role}>
            {msg.content}
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
            \u25A0
          </button>
        ) : (
          <button onClick={send} disabled={disabled || !input.trim()} aria-label="Send">
            \u2191
          </button>
        )}
      </div>
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
