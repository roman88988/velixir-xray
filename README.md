# velixir-xray

A tiny Node.js app that runs xray (VLESS + WebSocket) behind the velixir edge,
which terminates TLS on the app's `velixir.run` domain.

## How it works

- `postinstall` downloads the xray-core binary (linux-64) and extracts it.
- `server.js` spawns xray with a VLESS + WS inbound on localhost, and proxies
  WebSocket upgrades on the configured path through to xray.
- The same process serves subscription endpoints:
  - `GET /health` — health probe
  - `GET /sub` — Shadowrocket subscription (base64 vless link)
  - `GET /clash` — Clash subscription YAML

## Configuration (environment variables, set in the velixir dashboard)

| Variable  | Meaning                              |
| --------- | ------------------------------------ |
| `UUID`    | VLESS client UUID (required)         |
| `WS_PATH` | WebSocket path, default `/xray-ws`   |
| `NODE_NAME` | Node display name, default `velixir-xray` |
| `XRAY_PORT` | Local xray port, default `10000`  |

No secrets are stored in this repo. The node domain is derived from the
request `Host` header when serving `/sub` and `/clash`.
