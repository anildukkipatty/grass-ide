export const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>grass client</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1a1a2e;
    color: #e0e0e0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, monospace;
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  #status-bar {
    padding: 8px 16px;
    font-size: 12px;
    background: #16213e;
    border-bottom: 1px solid #0f3460;
    display: flex;
    align-items: center;
    gap: 8px;
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
    background: #0f3460;
    color: #e0e0e0;
  }
  .msg.assistant {
    align-self: flex-start;
    background: #16213e;
    color: #e0e0e0;
    border: 1px solid #0f3460;
  }
  .msg.error {
    align-self: center;
    background: #3c1414;
    color: #e74c3c;
    border: 1px solid #e74c3c;
    font-size: 13px;
  }
  .badge {
    font-size: 11px;
    color: #888;
    margin-top: 4px;
  }
  #input-bar {
    padding: 12px 16px;
    background: #16213e;
    border-top: 1px solid #0f3460;
    display: flex;
    gap: 8px;
  }
  #input-bar textarea {
    flex: 1;
    background: #1a1a2e;
    color: #e0e0e0;
    border: 1px solid #0f3460;
    border-radius: 6px;
    padding: 10px 12px;
    font-size: 14px;
    font-family: inherit;
    resize: none;
    outline: none;
    min-height: 42px;
    max-height: 120px;
  }
  #input-bar textarea:focus { border-color: #533483; }
  #input-bar textarea:disabled { opacity: 0.5; }
  #input-bar button {
    background: #533483;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 0 20px;
    font-size: 14px;
    cursor: pointer;
    white-space: nowrap;
  }
  #input-bar button:hover { background: #6c44a2; }
  #input-bar button:disabled { opacity: 0.4; cursor: not-allowed; }
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
    function connect() {
      const ws = new WebSocket("ws://localhost:3000");
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
            if (last && last.role === "assistant" && !last.complete) {
              return [...prev.slice(0, -1), { ...last, content: data.content }];
            }
            return [...prev, { role: "assistant", content: data.content, complete: false }];
          });
        } else if (data.type === "result") {
          setStreaming(false);
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === "assistant") {
              const cost = data.cost != null ? "$" + data.cost.toFixed(4) : null;
              const duration = data.duration_ms != null ? (data.duration_ms / 1000).toFixed(1) + "s" : null;
              const badge = [cost, duration].filter(Boolean).join(" · ");
              return [...prev.slice(0, -1), { ...last, complete: true, badge }];
            }
            return prev;
          });
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
        <button onClick={send} disabled={disabled || !input.trim()}>
          Send
        </button>
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
