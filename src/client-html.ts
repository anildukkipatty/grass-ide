export const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
<title>grass — bot hub</title>
<style>
  :root {
    --bg: #f7f7f9;
    --surface: #fff;
    --surface-2: #f0f0f4;
    --text: #16161a;
    --muted: #71717f;
    --faint: #a1a1b0;
    --border: #e4e4ec;
    --accent: #2f6fed;
    --accent-text: #fff;
    --danger: #cf3b2f;
    --ok: #1f9d55;
    --radius: 16px;
    --shadow-sm: 0 1px 2px rgba(16,16,24,.05);
    --shadow-md: 0 2px 6px rgba(16,16,24,.06), 0 12px 28px rgba(16,16,24,.08);
    --tint-l: 94%;
    --tint-s: 70%;
    --ink-l: 34%;
  }
  @media (prefers-color-scheme: dark) {
    :root:not(.light) {
      --bg: #101013;
      --surface: #18181d;
      --surface-2: #202027;
      --text: #ececf2;
      --muted: #9494a4;
      --faint: #6b6b7c;
      --border: #292932;
      --accent: #5f8dff;
      --accent-text: #0c0c10;
      --danger: #f0685c;
      --ok: #45c07d;
      --shadow-sm: 0 1px 2px rgba(0,0,0,.4);
      --shadow-md: 0 2px 6px rgba(0,0,0,.4), 0 12px 28px rgba(0,0,0,.35);
      --tint-l: 24%;
      --tint-s: 38%;
      --ink-l: 76%;
    }
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
  }
  button { font: inherit; color: inherit; cursor: pointer; background: none; border: 0; }
  input, textarea, select { font: inherit; color: inherit; }
  h1, h2, h3 { margin: 0; letter-spacing: -.02em; }

  /* Every screen owns the full window; we navigate by depth, not by columns. */
  .view { display: none; flex-direction: column; height: 100vh; height: 100dvh; }
  .view.active { display: flex; }
  .scroll { flex: 1; overflow-y: auto; }
  .wrap { width: 100%; max-width: 940px; margin: 0 auto; padding: 0 24px; }
  .wrap.narrow { max-width: 760px; }

  /* --- Top bars --- */
  .bar { border-bottom: 1px solid var(--border); background: var(--bg); position: sticky; top: 0; z-index: 5; }
  .bar-inner { display: flex; align-items: center; gap: 14px; min-height: 68px; padding-top: 12px; padding-bottom: 12px; }
  .bar-inner h1 { font-size: 22px; flex: 1; }
  .bar-title { flex: 1; min-width: 0; }
  .bar-title h2 { font-size: 17px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bar-title .sub { color: var(--muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .back {
    display: inline-flex; align-items: center; gap: 5px; flex: none;
    color: var(--muted); padding: 6px 10px 6px 6px; margin-left: -6px; border-radius: 9px;
    font-size: 13.5px; font-weight: 550;
  }
  .back:hover { background: var(--surface-2); color: var(--text); }
  .back .chev { font-size: 17px; line-height: 1; }

  .btn {
    display: inline-flex; align-items: center; gap: 7px; flex: none;
    padding: 9px 15px; border-radius: 11px; font-size: 14px; font-weight: 550;
    border: 1px solid var(--border); background: var(--surface); box-shadow: var(--shadow-sm);
  }
  .btn:hover { border-color: var(--faint); }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .btn.primary:hover { filter: brightness(1.06); }
  .btn.ghost { box-shadow: none; background: none; border-color: transparent; color: var(--muted); }
  .btn.ghost:hover { background: var(--surface-2); color: var(--text); }
  .btn.danger { color: var(--danger); border-color: transparent; background: none; box-shadow: none; }
  .btn.danger:hover { background: color-mix(in srgb, var(--danger) 10%, transparent); }

  /* --- Bot identity ---
     Each bot gets a stable hue from its name, so colour carries identity
     rather than decoration. --bot-hue is set inline per element. */
  .avatar {
    display: grid; place-items: center; flex: none;
    width: 44px; height: 44px; border-radius: 13px;
    background: hsl(var(--bot-hue) var(--tint-s) var(--tint-l));
    font-size: 21px; line-height: 1;
  }
  .avatar.lg { width: 56px; height: 56px; border-radius: 16px; font-size: 27px; }
  .avatar.sm { width: 30px; height: 30px; border-radius: 9px; font-size: 15px; }

  /* --- Home: the roster --- */
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr));
    gap: 16px; padding: 24px 0 60px;
  }
  .card {
    position: relative; overflow: hidden; text-align: left;
    display: flex; flex-direction: column; gap: 10px;
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 18px; min-height: 178px; box-shadow: var(--shadow-sm);
    transition: transform .14s ease, box-shadow .14s ease, border-color .14s ease;
  }
  .card::before {
    content: ""; position: absolute; inset: 0 0 auto 0; height: 3px;
    background: hsl(var(--bot-hue) 65% 55%);
  }
  .card:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: hsl(var(--bot-hue) 50% 62%); }
  .card h3 { font-size: 16px; }
  .card .desc {
    color: var(--muted); font-size: 13.5px; flex: 1;
    display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
  }
  .card .foot {
    display: flex; align-items: center; gap: 8px;
    color: var(--faint); font-size: 12px; padding-top: 2px;
  }
  .card .foot .dot { margin-left: auto; }
  .new-card {
    display: grid; place-items: center; gap: 8px; min-height: 178px;
    border: 1.5px dashed var(--border); border-radius: var(--radius); color: var(--muted);
    font-size: 14px; font-weight: 550;
  }
  .new-card:hover { border-color: var(--accent); color: var(--accent); background: var(--surface); }
  .new-card .plus { font-size: 24px; line-height: 1; }

  .dot { display: inline-flex; align-items: center; gap: 5px; }
  .dot::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--faint); }
  .dot.live { color: var(--ok); }
  .dot.live::before { background: var(--ok); box-shadow: 0 0 0 0 color-mix(in srgb, var(--ok) 60%, transparent); animation: pulse 1.8s ease-out infinite; }
  @keyframes pulse { to { box-shadow: 0 0 0 7px transparent; } }
  @media (prefers-reduced-motion: reduce) { .dot.live::before { animation: none; } }

  /* --- Bot page --- */
  .brief {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 16px 18px; margin: 22px 0 26px; box-shadow: var(--shadow-sm);
    border-left: 3px solid hsl(var(--bot-hue) 60% 55%);
  }
  .brief .label { font-size: 11px; letter-spacing: .07em; text-transform: uppercase; color: var(--faint); font-weight: 650; margin-bottom: 6px; }
  .brief p { margin: 0; color: var(--text); white-space: pre-wrap; }
  .brief p.none { color: var(--faint); font-style: italic; }

  .section-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .section-head h3 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--faint); flex: 1; }

  .threads { display: flex; flex-direction: column; gap: 8px; padding-bottom: 60px; }
  .thread {
    position: relative; display: flex; align-items: center; gap: 14px; text-align: left; width: 100%;
    background: var(--surface); border: 1px solid var(--border); border-radius: 13px;
    padding: 14px 16px; box-shadow: var(--shadow-sm);
    transition: border-color .14s ease, transform .14s ease;
  }
  .thread:hover { border-color: hsl(var(--bot-hue) 50% 62%); transform: translateX(2px); }
  .thread .body { flex: 1; min-width: 0; }
  .thread .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .thread .prev { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }
  .thread .meta { color: var(--faint); font-size: 12px; flex: none; text-align: right; }
  .thread .kill { opacity: 0; color: var(--faint); font-size: 17px; padding: 4px 6px; border-radius: 8px; flex: none; }
  .thread:hover .kill { opacity: 1; }
  .thread .kill:hover { color: var(--danger); background: var(--surface-2); }

  .empty { text-align: center; padding: 64px 20px; color: var(--muted); }
  .empty .big { font-size: 40px; margin-bottom: 12px; }
  .empty h3 { font-size: 17px; margin-bottom: 6px; }
  .empty p { margin: 0 auto 18px; max-width: 380px; font-size: 14px; }

  /* --- Conversation --- */
  .messages { flex: 1; overflow-y: auto; }
  .messages .wrap { padding-top: 26px; padding-bottom: 20px; display: flex; flex-direction: column; gap: 18px; }
  .msg { display: flex; gap: 12px; max-width: 100%; }
  .msg.user { flex-direction: row-reverse; }
  .msg .content { min-width: 0; max-width: 86%; }
  .bubble { padding: 11px 15px; border-radius: 15px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .msg.user .bubble { background: var(--accent); color: var(--accent-text); border-bottom-right-radius: 5px; }
  .msg.assistant .bubble { background: var(--surface); border: 1px solid var(--border); border-bottom-left-radius: 5px; box-shadow: var(--shadow-sm); }
  .msg.assistant .bubble:empty { display: none; }
  .msg.error .bubble { background: var(--surface); border: 1px solid var(--danger); color: var(--danger); font-size: 13.5px; }
  .who { font-size: 12px; color: var(--faint); margin: 0 4px 4px; }
  .msg.user .who { text-align: right; }

  .tool {
    display: flex; align-items: center; gap: 9px; margin-top: 7px;
    background: var(--surface-2); border-radius: 10px; padding: 7px 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--muted);
  }
  .tool b { color: var(--text); font-weight: 600; flex: none; }
  .tool span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .note { color: var(--faint); font-size: 12.5px; text-align: center; font-style: italic; }

  .perm {
    background: var(--surface); border: 1px solid var(--accent); border-radius: 14px;
    padding: 14px 16px; box-shadow: var(--shadow-md);
  }
  .perm .head { font-weight: 600; margin-bottom: 8px; }
  .perm pre {
    margin: 0 0 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;
    color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; max-height: 150px; overflow: auto;
  }
  .perm .acts { display: flex; gap: 8px; }

  /* --- Composer --- */
  .composer { border-top: 1px solid var(--border); background: var(--bg); }
  .composer .wrap { padding-top: 12px; padding-bottom: 18px; }
  .activity { display: flex; align-items: center; gap: 8px; height: 22px; padding-left: 4px; color: var(--muted); font-size: 12.5px; }
  .activity:empty { display: none; }
  .spinner {
    width: 11px; height: 11px; flex: none; border-radius: 50%;
    border: 1.5px solid var(--border); border-top-color: var(--accent); animation: spin .7s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  .box {
    display: flex; gap: 10px; align-items: flex-end;
    background: var(--surface); border: 1px solid var(--border); border-radius: 17px;
    padding: 9px 9px 9px 16px; box-shadow: var(--shadow-sm);
  }
  .box:focus-within { border-color: var(--accent); }
  .box textarea { flex: 1; border: 0; background: none; resize: none; outline: none; max-height: 200px; padding: 6px 0; }
  .send {
    width: 36px; height: 36px; border-radius: 11px; flex: none;
    background: var(--accent); color: var(--accent-text); font-size: 17px;
    display: flex; align-items: center; justify-content: center;
  }
  .send:disabled { opacity: .35; cursor: default; }
  .send.stop { background: var(--danger); }
  .send.stop::before { content: ""; width: 11px; height: 11px; border-radius: 2px; background: currentColor; }

  /* --- Modal --- */
  .backdrop {
    position: fixed; inset: 0; background: rgba(10,10,14,.5); backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center; padding: 20px; z-index: 30;
  }
  .modal {
    background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
    box-shadow: var(--shadow-md); width: min(580px, 100%); max-height: 90vh; overflow-y: auto; padding: 26px;
  }
  .modal h2 { font-size: 19px; margin-bottom: 20px; }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-weight: 600; font-size: 13px; margin-bottom: 6px; }
  .field .hint { font-weight: 400; color: var(--faint); }
  .field input, .field textarea, .field select {
    width: 100%; padding: 10px 12px; border-radius: 11px;
    border: 1px solid var(--border); background: var(--bg); outline: none;
  }
  .field input:focus, .field textarea:focus, .field select:focus { border-color: var(--accent); }
  .field textarea { resize: vertical; min-height: 110px; }
  .row2 { display: grid; grid-template-columns: 92px 1fr; gap: 10px; }
  .acts { display: flex; gap: 9px; justify-content: flex-end; align-items: center; margin-top: 22px; }
  .acts .spacer { flex: 1; }

  @media (max-width: 640px) {
    .wrap { padding: 0 16px; }
    .grid { grid-template-columns: 1fr 1fr; gap: 12px; }
    .bar-inner { min-height: 60px; }
  }
</style>
</head>
<body>

<!-- Home: the roster -->
<section class="view active" id="view-home">
  <div class="bar"><div class="wrap bar-inner">
    <h1>Your bots</h1>
    <button class="btn primary" id="new-bot"><span>+</span> New bot</button>
  </div></div>
  <div class="scroll"><div class="wrap"><div class="grid" id="grid"></div></div></div>
</section>

<!-- One bot: its brief and its threads -->
<section class="view" id="view-bot">
  <div class="bar"><div class="wrap bar-inner">
    <button class="back" id="to-home"><span class="chev">&lsaquo;</span> Bots</button>
    <div class="avatar sm" id="bot-avatar"></div>
    <div class="bar-title"><h2 id="bot-name"></h2></div>
    <button class="btn ghost" id="edit-bot">Edit</button>
  </div></div>
  <div class="scroll"><div class="wrap">
    <div class="brief" id="brief">
      <div class="label">Instructions</div>
      <p id="brief-text"></p>
    </div>
    <div class="section-head">
      <h3>Threads</h3>
      <button class="btn" id="new-thread">+ New thread</button>
    </div>
    <div class="threads" id="threads"></div>
  </div></div>
</section>

<!-- One thread -->
<section class="view" id="view-thread">
  <div class="bar"><div class="wrap narrow bar-inner">
    <button class="back" id="to-bot"><span class="chev">&lsaquo;</span> <span id="to-bot-label">Back</span></button>
    <div class="avatar sm" id="thread-avatar"></div>
    <div class="bar-title">
      <h2 id="thread-title"></h2>
      <div class="sub" id="thread-sub"></div>
    </div>
  </div></div>
  <div class="messages" id="messages"><div class="wrap narrow" id="messages-inner"></div></div>
  <div class="composer"><div class="wrap narrow">
    <div class="activity" id="activity"></div>
    <div class="box">
      <textarea id="input" rows="1" placeholder="Message…"></textarea>
      <button class="send" id="send" title="Send" aria-label="Send">&uarr;</button>
    </div>
  </div></div>
</section>

<script>
(function () {
  "use strict";

  // --- State ---
  var bots = [];
  var allThreads = [];        // every thread, for roster counts
  var threads = [];           // threads of the open bot
  var activeBot = null;
  var activeThread = null;
  var view = "home";          // home | bot | thread

  var sessionId = null;
  var stream = null;
  var liveBubble = null;
  var runningThreadId = null;

  // Turn lifecycle. "idle" is the only state in which the button sends;
  // otherwise it stops. "aborting" waits for the agent to confirm.
  var state = "idle";         // idle | starting | running | aborting
  var pendingPerms = 0;

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  // --- API ---
  function api(path, opts) {
    opts = opts || {};
    var init = { method: opts.method || "GET", headers: {} };
    if (opts.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) throw new Error(d.error || ("Request failed: " + r.status));
        return d;
      });
    });
  }

  /** A stable hue per bot, so colour means identity rather than decoration. */
  function hueOf(bot) {
    var seed = String(bot && (bot.id || bot.name) || "");
    var h = 0;
    for (var i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
    return h;
  }
  function tint(node, bot) { node.style.setProperty("--bot-hue", hueOf(bot)); return node; }

  function avatar(bot, size) {
    var n = tint(el("div", "avatar" + (size ? " " + size : "")), bot);
    n.textContent = bot.emoji || "\\u{1F916}";
    return n;
  }

  function relTime(iso) {
    var d = (Date.now() - new Date(iso).getTime()) / 1000;
    if (d < 60) return "just now";
    if (d < 3600) return Math.floor(d / 60) + "m ago";
    if (d < 86400) return Math.floor(d / 3600) + "h ago";
    if (d < 604800) return Math.floor(d / 86400) + "d ago";
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  // --- Navigation: depth, not columns ---
  function setView(next, push) {
    view = next;
    ["home", "bot", "thread"].forEach(function (v) {
      $("view-" + v).classList.toggle("active", v === next);
    });
    if (push !== false) {
      try { history.pushState({ view: next }, ""); } catch (e) {}
    }
  }

  window.addEventListener("popstate", function () {
    if (view === "thread") goBotView(false);
    else if (view === "bot") goHome(false);
  });

  function goHome(push) {
    activeBot = null;
    activeThread = null;
    detach();
    setView("home", push);
    return loadRoster();
  }

  function goBotView(push) {
    detach();
    activeThread = null;
    setView("bot", push);
    renderThreads();
  }

  // --- Home ---
  function loadRoster() {
    return Promise.all([api("/bots"), api("/threads")]).then(function (r) {
      bots = r[0].bots || [];
      allThreads = r[1].threads || [];
      renderRoster();
    });
  }

  function renderRoster() {
    var grid = $("grid");
    grid.innerHTML = "";

    if (!bots.length) {
      var e = el("div", "empty");
      e.appendChild(el("div", "big", "\\u{1F916}"));
      e.appendChild(el("h3", null, "No bots yet"));
      e.appendChild(el("p", null, "A bot is a standing set of instructions with a job to do \\u2014 keep the docs in sync, review every PR, cut a release. Give it a name and a brief, then talk to it in threads."));
      var cta = el("button", "btn primary", "Create your first bot");
      cta.onclick = function () { openBotModal(null); };
      e.appendChild(cta);
      grid.style.display = "block";
      grid.appendChild(e);
      return;
    }
    grid.style.display = "";

    bots.forEach(function (bot) {
      var mine = allThreads.filter(function (t) { return t.botId === bot.id; });
      var card = tint(el("button", "card"), bot);
      card.appendChild(avatar(bot));
      card.appendChild(el("h3", null, bot.name));
      card.appendChild(el("div", "desc", bot.description || "No description yet."));

      var foot = el("div", "foot");
      foot.appendChild(el("span", null, mine.length ? mine.length + (mine.length === 1 ? " thread" : " threads") : "No threads"));
      var live = mine.some(function (t) { return t.id === runningThreadId; });
      if (live) foot.appendChild(el("span", "dot live", "running"));
      else if (mine.length) foot.appendChild(el("span", "dot", relTime(mine[0].updatedAt)));
      card.appendChild(foot);

      card.onclick = function () { openBot(bot); };
      grid.appendChild(card);
    });

    var add = el("button", "new-card");
    add.appendChild(el("div", "plus", "+"));
    add.appendChild(el("div", null, "New bot"));
    add.onclick = function () { openBotModal(null); };
    grid.appendChild(add);
  }

  // --- Bot page ---
  function openBot(bot) {
    activeBot = bot;
    activeThread = null;
    detach();
    $("bot-name").textContent = bot.name;
    var av = $("bot-avatar");
    av.textContent = bot.emoji || "\\u{1F916}";
    tint(av, bot);
    tint($("brief"), bot);
    var brief = $("brief-text");
    brief.textContent = bot.instructions || "No instructions \\u2014 this bot behaves like plain Claude Code.";
    brief.className = bot.instructions ? "" : "none";
    setView("bot");
    return loadThreads();
  }

  function loadThreads() {
    if (!activeBot) return Promise.resolve();
    return api("/threads?botId=" + encodeURIComponent(activeBot.id)).then(function (d) {
      threads = d.threads || [];
      // Keep the roster's counts honest without a second round trip.
      allThreads = allThreads.filter(function (t) { return t.botId !== activeBot.id; }).concat(threads);
      renderThreads();
    });
  }

  function renderThreads() {
    var list = $("threads");
    list.innerHTML = "";
    if (!activeBot) return;

    if (!threads.length) {
      var e = el("div", "empty");
      e.appendChild(el("h3", null, "No threads yet"));
      e.appendChild(el("p", null, "Every conversation with " + activeBot.name + " lives in its own thread, and each one keeps its history."));
      var cta = el("button", "btn primary", "Start the first thread");
      cta.onclick = newThread;
      e.appendChild(cta);
      list.appendChild(e);
      return;
    }

    threads.forEach(function (t) {
      var row = tint(el("div", "thread"), activeBot);
      var body = el("div", "body");
      body.appendChild(el("div", "title", t.title));
      body.appendChild(el("div", "prev", t.preview || "No messages yet"));
      row.appendChild(body);

      var meta = el("div", "meta");
      if (t.id === runningThreadId) meta.appendChild(el("span", "dot live", "running"));
      else meta.appendChild(el("div", null, relTime(t.updatedAt)));
      row.appendChild(meta);

      var kill = el("button", "kill", "\\u00D7");
      kill.title = "Delete thread";
      kill.onclick = function (ev) {
        ev.stopPropagation();
        if (!confirm("Delete this thread? The Claude Code transcript stays on disk.")) return;
        api("/threads/" + t.id, { method: "DELETE" }).then(loadThreads).catch(showError);
      };
      row.appendChild(kill);

      row.onclick = function () { openThread(t); };
      list.appendChild(row);
    });
  }

  function newThread() {
    if (!activeBot) return;
    api("/threads", { method: "POST", body: { botId: activeBot.id } })
      .then(function (d) { return loadThreads().then(function () { openThread(d.thread); }); })
      .catch(showError);
  }

  // --- Thread ---
  function openThread(thread) {
    activeThread = thread;
    detach();
    $("thread-title").textContent = thread.title;
    $("thread-sub").textContent = thread.repoPath;
    $("to-bot-label").textContent = activeBot ? activeBot.name : "Back";
    var av = $("thread-avatar");
    av.textContent = activeBot ? (activeBot.emoji || "\\u{1F916}") : "\\u{1F916}";
    tint(av, activeBot || {});
    $("input").placeholder = "Message " + (activeBot ? activeBot.name : "bot") + "\\u2026";
    setState("idle");
    setActivity("");
    setView("thread");
    return loadMessages();
  }

  function loadMessages() {
    var box = $("messages-inner");
    box.innerHTML = "";
    if (!activeThread) return Promise.resolve();
    return api("/threads/" + activeThread.id + "/messages").then(function (d) {
      var msgs = d.messages || [];
      if (!msgs.length) {
        var e = el("div", "empty");
        e.appendChild(el("h3", null, "Say the first thing"));
        e.appendChild(el("p", null, activeBot ? activeBot.name + " already knows its job \\u2014 tell it what to do this time." : "Send a message to start."));
        box.appendChild(e);
        return;
      }
      msgs.forEach(function (m) {
        var kind = m.role === "user" ? "user" : "assistant";
        var content = startMessage(kind);
        (m.content || []).forEach(function (b) {
          if (b.type === "text") appendText(content, b.text);
          else if (b.type === "tool_use") appendTool(content, b.tool_name, b.tool_input);
          else if (b.type === "image_url") {
            var img = document.createElement("img");
            img.src = b.url; img.style.maxWidth = "100%"; img.style.borderRadius = "12px";
            content.appendChild(img);
          }
        });
      });
      scrollDown();
    });
  }

  /** Opens a message row and returns its content column, ready for blocks. */
  function startMessage(kind) {
    var box = $("messages-inner");
    var placeholder = box.querySelector(".empty");
    if (placeholder) placeholder.remove();

    var row = el("div", "msg " + kind);
    if (kind === "assistant" && activeBot) row.appendChild(avatar(activeBot, "sm"));
    var content = el("div", "content");
    if (kind === "assistant" && activeBot) content.appendChild(el("div", "who", activeBot.name));
    content.appendChild(el("div", "bubble"));
    row.appendChild(content);
    box.appendChild(row);
    scrollDown();
    return content;
  }

  function bubbleOf(content) { return content.querySelector(".bubble"); }

  function appendText(content, text) {
    if (!text) return;
    var b = bubbleOf(content);
    b.textContent = b.textContent ? b.textContent + "\\n\\n" + text : text;
  }

  function appendTool(content, name, input) {
    var chip = el("div", "tool");
    chip.appendChild(el("b", null, name));
    var summary = typeof input === "string" ? input : JSON.stringify(input || {});
    chip.appendChild(el("span", null, summary.slice(0, 200)));
    content.appendChild(chip);
    scrollDown();
  }

  function scrollDown() {
    var m = $("messages");
    m.scrollTop = m.scrollHeight;
  }

  function showError(err) {
    var content = startMessage("error");
    appendText(content, err && err.message ? err.message : String(err));
  }

  // --- Sending ---
  function send() {
    var input = $("input");
    var text = input.value.trim();
    if (!text || !activeThread || state !== "idle") return;

    input.value = "";
    input.style.height = "auto";
    appendText(startMessage("user"), text);
    setState("starting");
    setActivity("Sending\\u2026");
    runningThreadId = activeThread.id;

    api("/chat", { method: "POST", body: { threadId: activeThread.id, prompt: text } })
      .then(function (d) {
        sessionId = d.sessionId;
        setState("running");
        setActivity("Thinking\\u2026");
        openStream(d.sessionId);
        loadThreads();
      })
      .catch(function (err) { showError(err); finishTurn(); });
  }

  /** Asks the server to abort. The agent's "aborted" event is what actually
   *  returns the button to Send. */
  function abort() {
    if (!sessionId || state === "idle" || state === "aborting") return;
    setState("aborting");
    setActivity("Stopping\\u2026");
    api("/sessions/" + encodeURIComponent(sessionId) + "/abort", { method: "POST" })
      .catch(function (err) { showError(err); finishTurn(); });
  }

  function openStream(id) {
    closeStream();
    liveBubble = null;
    stream = new EventSource("/events?sessionId=" + encodeURIComponent(id));

    stream.addEventListener("assistant", function (ev) {
      var d = JSON.parse(ev.data);
      if (!liveBubble) liveBubble = startMessage("assistant");
      appendText(liveBubble, d.content);
      scrollDown();
    });

    stream.addEventListener("tool_use", function (ev) {
      var d = JSON.parse(ev.data);
      if (!liveBubble) liveBubble = startMessage("assistant");
      appendTool(liveBubble, d.tool_name, d.tool_input);
    });

    stream.addEventListener("status", function (ev) {
      var d = JSON.parse(ev.data);
      if (state === "aborting") return;
      if (d.status === "thinking") setActivity("Thinking\\u2026");
      else if (d.status === "tool") setActivity("Running " + (d.tool_name || "tool") + "\\u2026");
      else if (d.status === "tool_summary" && d.summary) setActivity(d.summary);
    });

    stream.addEventListener("permission_request", function (ev) {
      pendingPerms++;
      setActivity("Waiting for your approval\\u2026");
      renderPermission(JSON.parse(ev.data));
    });

    stream.addEventListener("error", function (ev) {
      // Fires for an agent error (has data) and for a transport drop (none).
      // EventSource retries drops itself, so only give up once it is closed.
      if (ev.data) {
        try { showError(new Error(JSON.parse(ev.data).message)); }
        catch (e) { showError(new Error("Stream error")); }
        finishTurn();
        return;
      }
      if (!stream || stream.readyState === 2) { setActivity("Connection lost"); finishTurn(); }
      else setActivity("Reconnecting\\u2026");
    });

    stream.addEventListener("aborted", function () {
      $("messages-inner").appendChild(el("div", "note", "Stopped."));
      scrollDown();
      finishTurn();
    });

    stream.addEventListener("done", finishTurn);
    stream.addEventListener("result", function () { /* turn summary */ });
  }

  function renderPermission(data) {
    var card = el("div", "perm");
    card.appendChild(el("div", "head", "Allow " + data.toolName + "?"));
    card.appendChild(el("pre", null, JSON.stringify(data.input, null, 2)));
    var acts = el("div", "acts");
    var allow = el("button", "btn primary", "Allow");
    var deny = el("button", "btn", "Deny");
    function respond(ok) {
      allow.disabled = deny.disabled = true;
      api("/sessions/" + encodeURIComponent(sessionId) + "/permission", { method: "POST", body: { toolUseID: data.toolUseID, approved: ok } })
        .then(function () {
          card.replaceWith(el("div", "note", (ok ? "Allowed " : "Denied ") + data.toolName));
          pendingPerms = Math.max(0, pendingPerms - 1);
          if (!pendingPerms && state === "running") setActivity("Thinking\\u2026");
        })
        .catch(showError);
    }
    allow.onclick = function () { respond(true); };
    deny.onclick = function () { respond(false); };
    acts.appendChild(allow);
    acts.appendChild(deny);
    card.appendChild(acts);
    $("messages-inner").appendChild(card);
    scrollDown();
  }

  function finishTurn() {
    closeStream();
    liveBubble = null;
    pendingPerms = 0;
    runningThreadId = null;
    var keep = $("activity").textContent === "Connection lost";
    setState("idle");
    if (!keep) setActivity("");
    loadThreads();
  }

  function closeStream() { if (stream) { stream.close(); stream = null; } }

  /** Leaves a running turn alone server-side, but stops following it here. */
  function detach() {
    closeStream();
    liveBubble = null;
    pendingPerms = 0;
    setState("idle");
    setActivity("");
  }

  /** The one place that decides what the composer looks like. */
  function setState(next) {
    state = next;
    var running = next !== "idle";
    var send = $("send");
    send.classList.toggle("stop", running);
    send.textContent = running ? "" : "\\u2191";   // stop glyph is drawn by CSS
    send.title = running ? "Stop" : "Send";
    send.setAttribute("aria-label", running ? "Stop" : "Send");
    send.disabled = next === "aborting" || (!running && !activeThread);
  }

  function setActivity(text) {
    var box = $("activity");
    box.textContent = "";
    if (!text) return;
    if (state !== "idle" && text.indexOf("Waiting for your approval") === -1 && text !== "Connection lost") {
      box.appendChild(el("div", "spinner"));
    }
    box.appendChild(el("span", null, text));
  }

  // --- Bot editor ---
  function openBotModal(bot) {
    var editing = !!bot;
    var backdrop = el("div", "backdrop");
    var modal = el("div", "modal");
    modal.appendChild(el("h2", null, editing ? "Edit bot" : "New bot"));

    function field(label, hint, control) {
      var wrap = el("div", "field");
      var lab = el("label", null, label);
      if (hint) lab.appendChild(el("span", "hint", "  " + hint));
      wrap.appendChild(lab);
      wrap.appendChild(control);
      modal.appendChild(wrap);
      return control;
    }

    var emoji = el("input");
    emoji.value = bot ? bot.emoji : "\\u{1F916}";
    var name = el("input");
    name.value = bot ? bot.name : "";
    name.placeholder = "Doc Spot";
    var row = el("div", "row2");
    row.appendChild(emoji);
    row.appendChild(name);
    field("Name", null, row);

    var description = field("Description", "one line, shown on the card", el("input"));
    description.value = bot ? bot.description : "";
    description.placeholder = "Keeps documentation in sync with the code";

    var instructions = field("Instructions", "appended to Claude Code's system prompt", el("textarea"));
    instructions.value = bot ? bot.instructions : "";
    instructions.placeholder = "You keep documentation in sync with the code. On each run, read the latest commit and update the docs it affects.";

    var repoPath = field("Working directory", "default for new threads", el("input"));
    repoPath.value = bot ? (bot.repoPath || "") : "";
    repoPath.placeholder = "blank uses the server's directory";

    var model = field("Model", "optional", el("input"));
    model.value = bot ? (bot.model || "") : "";
    model.placeholder = "claude-sonnet-4-6";

    var permissionMode = field("Permissions", null, el("select"));
    [["ask-permissions", "Ask before each tool"], ["auto-approve", "Auto-approve tools"], ["plan", "Plan only (no edits)"]]
      .forEach(function (o) {
        var opt = el("option", null, o[1]);
        opt.value = o[0];
        permissionMode.appendChild(opt);
      });
    permissionMode.value = bot ? bot.permissionMode : "ask-permissions";

    var allowedTools = field("Allowed tools", "comma-separated; blank means all", el("input"));
    allowedTools.value = bot && bot.allowedTools ? bot.allowedTools.join(", ") : "";
    allowedTools.placeholder = "Read, Grep, Edit, Bash";

    var acts = el("div", "acts");
    if (editing) {
      var del = el("button", "btn danger", "Delete");
      del.onclick = function () {
        if (!confirm("Delete " + bot.name + " and all of its threads?")) return;
        api("/bots/" + bot.id, { method: "DELETE" })
          .then(function () { backdrop.remove(); return goHome(); })
          .catch(showError);
      };
      acts.appendChild(del);
    }
    acts.appendChild(el("div", "spacer"));
    var cancel = el("button", "btn", "Cancel");
    cancel.onclick = function () { backdrop.remove(); };
    var save = el("button", "btn primary", editing ? "Save" : "Create bot");
    save.onclick = function () {
      if (!name.value.trim()) { name.focus(); return; }
      var tools = allowedTools.value.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
      var body = {
        name: name.value.trim(),
        emoji: emoji.value.trim() || "\\u{1F916}",
        description: description.value.trim(),
        instructions: instructions.value,
        repoPath: repoPath.value.trim() || undefined,
        model: model.value.trim() || undefined,
        permissionMode: permissionMode.value,
        allowedTools: tools.length ? tools : undefined
      };
      var req = editing
        ? api("/bots/" + bot.id, { method: "PATCH", body: body })
        : api("/bots", { method: "POST", body: body });
      req.then(function (d) {
        backdrop.remove();
        return api("/threads").then(function (r) {
          allThreads = r.threads || [];
          return api("/bots");
        }).then(function (r) {
          bots = r.bots || [];
          if (editing) { openBot(d.bot); }
          else { renderRoster(); openBot(d.bot); }
        });
      }).catch(showError);
    };
    acts.appendChild(cancel);
    acts.appendChild(save);
    modal.appendChild(acts);

    backdrop.appendChild(modal);
    backdrop.onclick = function (ev) { if (ev.target === backdrop) backdrop.remove(); };
    document.addEventListener("keydown", function esc(ev) {
      if (ev.key === "Escape") { backdrop.remove(); document.removeEventListener("keydown", esc); }
    });
    document.body.appendChild(backdrop);
    name.focus();
  }

  // --- Wiring ---
  $("new-bot").onclick = function () { openBotModal(null); };
  $("edit-bot").onclick = function () { if (activeBot) openBotModal(activeBot); };
  $("new-thread").onclick = newThread;
  $("to-home").onclick = function () { goHome(); };
  $("to-bot").onclick = function () { goBotView(); };
  $("send").onclick = function () { if (state === "idle") send(); else abort(); };

  var input = $("input");
  input.addEventListener("input", function () {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 200) + "px";
  });
  input.addEventListener("keydown", function (ev) {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); if (state === "idle") send(); }
  });

  setView("home", false);
  loadRoster().catch(function (err) { console.error(err); });
})();
</script>
</body>
</html>`;
