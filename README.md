# Ephemeral Anonymous Chat — MVP (Device-Bound)

## What this is
A minimal single-page ephemeral chat that matches the provided spec:
- No signup/login
- Device-bound ID stored in browser localStorage
- Public broadcast chat (real-time via WebSocket)
- Private 1-to-1 chat via WebSocket
- Ephemeral: no persistent storage; data held in-memory only
- Basic rate-limiting and XSS protection
- One active session per device ID (new connections kick old connection)

## Run locally
1. Create a virtualenv and install dependencies:
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

2. Run the server:
```bash
uvicorn main:app --reload --port 8000
```

3. Open http://localhost:8000 in multiple browser windows/tabs (or other devices on the same network).

## Files
- `main.py` — FastAPI server with WebSocket endpoints (`/ws/public`, `/ws/private/{target_id}`) and `/online-users`
- `static/index.html` & `static/app.js` — frontend SPA (vanilla JS)
- `requirements.txt` — Python dependencies
- `README.md` — this file

## Notes & Limitations (MVP)
- In-memory only. For production, swap CONNECTIONS + messaging to Redis Pub/Sub if you need multiple server instances.
- No message persistence (ephemeral by design).
- Very small message-size and simple XSS sanitizing; consider a proper sanitizer for production.
- Rate-limiting is coarse; improve per-API/per-IP controls for production.
- Private chat is naive: it connects the "from" side into a websocket and forwards messages to the target's connection. Both sides MUST open private websocket to receive messages reliably.
- For mobile unreliability, the server doesn't implement delayed-removal window; you can add a timeout before removing a disconnected device from PUBLIC_ROOM.

## License
MIT
