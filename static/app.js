(function () {
  // helpers
  function el(q) { return document.querySelector(q) }
  function sanitize(s) { const div = document.createElement('div'); div.textContent = s; return div.innerHTML }
  // device id persisted in localStorage to keep device-bound sessions between reloads on same device
  let deviceId = localStorage.getItem("ephemeral_device_id");
  if (!deviceId) {
    deviceId = "dev-" + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("ephemeral_device_id", deviceId);
  }
  el("#deviceId").innerText = deviceId;

  // connections
  let publicWs = null;
  const privateWss = {}; // targetId -> websocket
  const privateContainers = {}; // targetId -> DOM container

  function appendMessage(text, meta) {
    const c = document.createElement("div"); c.className = "msg";
    c.innerHTML = "<div class='small'>" + (meta || "") + "</div><div>" + sanitize(text) + "</div>";
    el("#messages").appendChild(c);
    el("#messages").scrollTop = el("#messages").scrollHeight;
  }

  async function fetchOnline() {
    try {
      const r = await fetch("/online-users");
      const list = await r.json();
      const box = el("#onlineList"); box.innerHTML = "";
      list.forEach(id => {
        if (id === deviceId) id = id + " (you)";
        const div = document.createElement("div"); div.className = "user";
        div.innerText = id;
        div.onclick = function () {
          // extract real id if it's "you"
          const tid = this.innerText.replace(" (you)", "");
          if (tid === deviceId) { alert("That's you!"); return; }
          openPrivateChat(tid);
        };
        box.appendChild(div);
      });
    } catch (e) {
      console.error(e);
    }
  }

  function connectPublic() {
    const qs = "?device_id=" + encodeURIComponent(deviceId);
    publicWs = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/public" + qs);
    publicWs.onopen = () => { appendMessage("Connected to public chat", "system"); };
    publicWs.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === "join") { appendMessage("User " + d.device_id + " joined", "system"); fetchOnline(); return; }
        if (d.type === "leave") { appendMessage("User " + d.device_id + " left", "system"); fetchOnline(); return; }
        if (d.type === "public_message") { appendMessage(d.text, "from: " + d.from); return; }
        if (d.type === "error") { appendMessage("ERROR: " + d.message, "system"); return; }
      } catch (e) { console.error(e) }
    };
    publicWs.onclose = () => { appendMessage("Public socket closed", "system"); setTimeout(connectPublic, 2000); };
    // heartbeat ping
    setInterval(() => { if (publicWs && publicWs.readyState === 1) publicWs.send(JSON.stringify({ type: "ping" })); }, 15000);
  }

  function openPrivateChat(targetId) {
    if (privateWss[targetId]) { alert("Private chat window already open"); return; }
    const container = document.createElement("div"); container.className = "private-chat";
    container.innerHTML = `
      <div class="private-head"><span>Private: ${targetId}</span> <button data-close>Close</button></div>
      <div class="private-body" id="private-body-${targetId}"></div>
      <div style="padding:8px;display:flex;gap:6px;border-top:1px solid #eef2f7">
        <input id="private-input-${targetId}" placeholder="Message..." style="flex:1;padding:6px;border:1px solid #e5e7eb;border-radius:6px"/>
        <button data-send>Send</button>
      </div>
    `;
    container.querySelector("[data-close]").onclick = () => { try { privateWss[targetId].close(); } catch (e) { } container.remove(); delete privateWss[targetId]; delete privateContainers[targetId]; };
    container.querySelector("[data-send]").onclick = () => {
      const v = el("#private-input-" + targetId).value.trim();
      if (!v) return;
      try {
        privateWss[targetId].send(JSON.stringify({ type: "message", text: v , to: targetId  }));
        const body = el("#private-body-" + targetId);
        const div = document.createElement("div"); div.className = "msg"; div.innerHTML = `<div class="small">you</div><div>${sanitize(v)}</div>`; body.appendChild(div); body.scrollTop = body.scrollHeight;
        el("#private-input-" + targetId).value = "";
      } catch (e) { alert("Not connected"); }
    };
    document.body.appendChild(container);
    privateContainers[targetId] = container;
    // connect ws: /ws/private/{targetId}?from={deviceId}
    const qs = "?from=" + encodeURIComponent(deviceId);
    const ws = new WebSocket((location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws/private/" + encodeURIComponent(targetId) + qs);
    ws.onopen = () => { const b = el("#private-body-" + targetId); const d = document.createElement("div"); d.className = "small"; d.innerText = "Private socket open"; b.appendChild(d); };
    ws.onmessage = (ev) => {
      try {
        const d = JSON.parse(ev.data);
        if (d.type === "private_request") { const b = el("#private-body-" + targetId); const div = document.createElement("div"); div.className = "small"; div.innerText = `${d.from} requested private chat`; b.appendChild(div); return; }
        if (d.type === "private_message") { const b = el("#private-body-" + targetId); const div = document.createElement("div"); div.className = "msg"; div.innerHTML = `<div class='small'>from: ${d.from}</div><div>${sanitize(d.text)}</div>`; b.appendChild(div); b.scrollTop = b.scrollHeight; return; }
        if (d.type === "error") { appendMessage("Private ERROR: " + d.message, "system"); return; }
        if (d.type === "info") { appendMessage("Info: " + d.message, "system"); return; }
      } catch (e) { console.error(e) }
    };
    ws.onclose = () => { const b = el("#private-body-" + targetId); const d = document.createElement("div"); d.className = "small"; d.innerText = "Private socket closed"; b.appendChild(d); };
    privateWss[targetId] = ws;
  }

  // Enter key in input
el("#publicInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault(); // avoid line break
    el("#sendPublic").click(); // call same function
  }
});
  // UI wiring
  el("#sendPublic").onclick = () => {
    const v = el("#publicInput").value.trim();
    if (!v) return;
    try {
      publicWs.send(JSON.stringify({ type: "message", text: v }));
      // appendMessage(v, "you");
      el("#publicInput").value = "";
    } catch (e) { alert("Public socket not connected"); }
  };
  el("#refreshBtn").onclick = fetchOnline;
  el("#clearBtn").onclick = () => { localStorage.removeItem("ephemeral_device_id"); location.reload(); };
  // initialize
  connectPublic();
  fetchOnline();
  // aggressive reconnect: poll online users every 10s
  setInterval(fetchOnline, 10000);
})();
