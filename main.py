from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
import uuid, asyncio, html, time

app = FastAPI(title="Ephemeral Anonymous Chat (Device-Bound) MVP")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend
app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
async def get_index():
    return FileResponse("static/index.html")

@app.get("/online-users")
async def online_users():
    # return list of currently connected device IDs
    return JSONResponse(list(CONNECTIONS.keys()))

# In-memory state
CONNECTIONS = {}  # device_id -> {"ws": WebSocket, "last_seen": ts, "busy": False}
PUBLIC_ROOM = set()  # set of device_ids connected to public channel
LAST_MSG_TS = {}  # device_id -> timestamp of last public/private message (rate limiting)
RATE_LIMIT_SEC = 0.25  # minimal seconds between messages (250 ms)

# util
def escape(msg: str) -> str:
    # basic XSS protection - escape HTML
    return html.escape(msg)

async def _send_safe(ws: WebSocket, data: dict):
    try:
        await ws.send_json(data)
    except Exception:
        # ignore send errors; consumer will eventually get disconnected
        pass

# Enforce single session per device: if new connection appears, close old
async def register_connection(device_id: str, ws: WebSocket):
    # close old connection if present
    old = CONNECTIONS.get(device_id)
    if old:
        try:
            await old["ws"].close(code=3000)
        except Exception:
            pass
    CONNECTIONS[device_id] = {"ws": ws, "last_seen": time.time(), "busy": False}

async def unregister_connection(device_id: str):
    CONNECTIONS.pop(device_id, None)
    PUBLIC_ROOM.discard(device_id)
    LAST_MSG_TS.pop(device_id, None)
from urllib.parse import parse_qs

CONNECTIONS = {}  # { device_id: { "ws": ws, "last_seen": ts, "busy": False } }
PRIVATE_SESSIONS = {}  # { (from_id, target_id): ws }


# Public WebSocket: broadcast
@app.websocket("/ws/public")
async def ws_public(ws: WebSocket):
    # query params: device_id
    await ws.accept()
    params = {}
    if ws.scope.get("query_string"):
        params = {k: v[0] for k, v in parse_qs(ws.scope["query_string"].decode()).items()}
    device_id = params.get("device_id") or str(uuid.uuid4())[:8]
    await register_connection(device_id, ws)
    PUBLIC_ROOM.add(device_id)
    # notify everyone of new online user
    await broadcast({"type":"join","device_id":device_id, "online": list(PUBLIC_ROOM)})
    try:
        while True:
            raw = await ws.receive_json()
            CONNECTIONS.get(device_id, {})["last_seen"] = time.time()
            # Heartbeat / ping
            msg_type = raw.get("type","message")
            if msg_type == "ping":
                await _send_safe(ws, {"type":"pong", "ts": time.time()})
                continue
            # Rate limit
            now = time.time()
            last = LAST_MSG_TS.get(device_id, 0)
            if now - last < RATE_LIMIT_SEC:
                await _send_safe(ws, {"type":"error","message":"You're sending messages too quickly."})
                continue
            LAST_MSG_TS[device_id] = now
            # Broadcast public message
            if msg_type == "message":
                text = escape(str(raw.get("text","")) )[:2000]
                payload = {"type":"public_message","from":device_id,"text":text, "ts": now}
                await broadcast(payload)
    except WebSocketDisconnect:
        pass
    finally:
        await unregister_connection(device_id)
        await broadcast({"type":"leave","device_id":device_id, "online": list(PUBLIC_ROOM)})

# Private WebSocket: one-to-one by specifying target_id and from device param
@app.websocket("/ws/private/{target_id}")
async def ws_private(ws: WebSocket, target_id: str):
    await ws.accept()

    params = {}
    if ws.scope.get("query_string"):
        raw_qs = ws.scope["query_string"].decode()
        params = {k: v[0] for k, v in parse_qs(raw_qs).items()}

    from_id = params.get("from") or str(uuid.uuid4())[:8]

    # register base connection
    await register_connection(from_id, ws)

    # register private session
    PRIVATE_SESSIONS[(from_id, target_id)] = ws

    try:
        # notify target if online
        target_conn = CONNECTIONS.get(target_id)
        if target_conn:
            await _send_safe(target_conn["ws"], {
                "type": "private_request", "from": from_id
            })

        while True:
            raw = await ws.receive_json()
            CONNECTIONS[from_id]["last_seen"] = time.time()
            msg_type = raw.get("type", "message")

            if msg_type == "ping":
                await _send_safe(ws, {"type": "pong", "ts": time.time()})
                continue

            now = time.time()
            last = LAST_MSG_TS.get(from_id, 0)
            if now - last < RATE_LIMIT_SEC:
                await _send_safe(ws, {"type": "error","message":"You're sending too quickly."})
                continue
            LAST_MSG_TS[from_id] = now

            if msg_type == "message":
                text = escape(str(raw.get("text", "")))[:2000]
                payload = {
                    "type": "private_message",
                    "from": from_id,
                    "to": target_id,
                    "text": text,
                    "ts": now
                }

                # check if target has a private session
                t = PRIVATE_SESSIONS.get((target_id, from_id))
                if t:
                    await _send_safe(t, payload)
                else:
                    await _send_safe(ws, {"type": "error", "message": "Target not in private chat."})

    except WebSocketDisconnect:
        pass
    finally:
        PRIVATE_SESSIONS.pop((from_id, target_id), None)
        await unregister_connection(from_id)


# broadcast helper
async def broadcast(payload: dict):
    stale = []
    for did, info in list(CONNECTIONS.items()):
        ws = info["ws"]
        try:
            await ws.send_json(payload)
        except Exception:
            stale.append(did)
    for s in stale:
        await unregister_connection(s)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
