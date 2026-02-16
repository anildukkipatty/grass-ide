export const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
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
    display: flex;
    flex-direction: column;
  }
  #status-bar {
    padding: 8px 16px;
    font-size: 12px;
    background: var(--bar-bg);
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .theme-toggle {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--toggle-text);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 4px;
    line-height: 1;
  }
  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #e74c3c;
  }
  .status-dot.connected { background: #2ecc71; }
  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .msg {
    max-width: 80%;
    padding: 10px 14px;
    border-radius: 8px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
    font-size: 14px;
  }
  .msg.user {
    align-self: flex-end;
    background: var(--msg-user-bg);
    color: var(--msg-user-text);
  }
  .msg.assistant {
    align-self: flex-start;
    background: var(--msg-assistant-bg);
    color: var(--msg-assistant-text);
    border: 1px solid var(--msg-assistant-border);
  }
  .msg.error {
    align-self: center;
    background: var(--msg-error-bg);
    color: var(--msg-error-text);
    border: 1px solid var(--msg-error-border);
    font-size: 13px;
  }
  .badge {
    font-size: 11px;
    color: var(--badge-text);
    margin-top: 4px;
  }
  #input-bar {
    padding: 12px 16px;
    background: var(--bar-bg);
    border-top: 1px solid var(--border);
    display: flex;
    gap: 8px;
  }
  #input-bar textarea {
    flex: 1;
    background: var(--input-bg);
    color: var(--input-text);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 14px;
    font-family: inherit;
    resize: none;
    outline: none;
    min-height: 42px;
    max-height: 120px;
  }
  #input-bar textarea:focus { border-color: var(--accent); }
  #input-bar textarea:disabled { opacity: 0.5; }
  #input-bar button {
    background: var(--accent);
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0 20px;
    font-size: 14px;
    cursor: pointer;
    white-space: nowrap;
  }
  #input-bar button:hover { background: var(--accent-hover); }
  #input-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
  #input-bar button.abort {
    background: #e74c3c;
  }
  #input-bar button.abort:hover {
    background: #c0392b;
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

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("theme") || "system");
  const wsRef = useRef(null);
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
    if (theme !== "system") root.classList.add(theme);
    localStorage.setItem("theme", theme);
  }, [theme]);

  const cycleTheme = useCallback(() => {
    setTheme(t => t === "system" ? "light" : t === "light" ? "dark" : "system");
  }, []);

  useEffect(() => {
    function connect() {
      const ws = new WebSocket(\`ws://\${window.location.hostname}:3000\`);
      wsRef.current = ws;

      ws.onopen = () => setConnected(true);

      ws.onclose = () => {
        setConnected(false);
        setStreaming(false);
        setTimeout(connect, 2000);
      };

      ws.onerror = () => ws.close();

      ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch { return; }

        if (data.type === "assistant") {
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant" && !last.complete && last.msgId === data.id) {
              return [...prev.slice(0, -1), { ...last, content: data.content }];
            }
            return [...prev, { role: "assistant", content: data.content, complete: false, msgId: data.id }];
          });
        } else if (data.type === "result") {
          setStreaming(false);
          setMessages(prev => {
            const cost = data.cost != null ? "$" + data.cost.toFixed(4) : null;
            const duration = data.duration_ms != null ? (data.duration_ms / 1000).toFixed(1) + "s" : null;
            const badge = [cost, duration].filter(Boolean).join(" · ");
            const lastIdx = prev.length - 1;
            return prev.map((msg, i) =>
              msg.role === "assistant" && !msg.complete
                ? { ...msg, complete: true, ...(i === lastIdx ? { badge } : {}) }
                : msg
            );
          });
        } else if (data.type === "aborted") {
          setStreaming(false);
          setMessages(prev => [...prev, { role: "error", content: "⚠️ " + data.message }]);
        } else if (data.type === "error") {
          setStreaming(false);
          setMessages(prev => [...prev, { role: "error", content: data.message }]);
        }
      };
    }

    connect();
    return () => wsRef.current?.close();
  }, []);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || !connected || streaming) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    wsRef.current.send(JSON.stringify({ type: "message", content: text }));
    setInput("");
    setStreaming(true);
  }, [input, connected, streaming]);

  const abort = useCallback(() => {
    if (!connected || !streaming) return;
    wsRef.current.send(JSON.stringify({ type: "abort" }));
  }, [connected, streaming]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const disabled = !connected || streaming;

  return (
    <>
      <div id="status-bar">
        <div className={"status-dot" + (connected ? " connected" : "")} />
        <span>{connected ? (streaming ? "Streaming..." : "Connected") : "Connecting..."}</span>
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
      <div id="input-bar">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message..."
          rows={1}
          disabled={disabled}
        />
        {streaming ? (
          <button onClick={abort} className="abort">
            Abort
          </button>
        ) : (
          <button onClick={send} disabled={disabled || !input.trim()}>
            Send
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
