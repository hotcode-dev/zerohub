---
type: quickstart
title: ZeroHub Quickstart
description: What ZeroHub is, the monorepo layout, and how to run the signaling server and instantiate the TypeScript/JavaScript client to establish a peer-to-peer WebRTC connection.
tags: [quickstart, getting-started, monorepo, server, client]
verified:
  - by: openwiki/0.6.0
    at: 2026-10-03T07:04:30.122Z
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-ce2b753bb7cfd4f636edd856
    resource: repo://client/src/index.ts
  - id: openwiki-source-718b618612c033c4f36b3a45
    resource: repo://client/src/zeroHub.ts
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-e27a23c64f72b7d3d77630c6
    resource: repo://server/pkg/handler/handler.go
generated: { by: "hermes", at: "2026-10-03T07:04:30.122Z" }
---

# ZeroHub Quickstart

ZeroHub is a **WebRTC signaling server** with a TypeScript/JavaScript SDK. It
is designed to be minimal: the server's only job is to manage hubs (rooms) and
relay Session Description Protocol (SDP) between peers over a WebSocket so they
can establish direct peer-to-peer WebRTC connections. Once connected, the
server is out of the data path.

This page is the canonical entry point to the repository wiki. Use it to
orient, then follow the related pages for depth:

- **Architecture Overview** — how the server, client, protobuf protocol, and
  storage fit together end to end.
- **Signaling Protocol & Peer Lifecycle** — the protobuf wire format and the
  `PeerStatus` state machine.
- **Go Signaling Server** — the server subsystem in detail.
- **TypeScript Client SDK** — the `@zero-hub/client` SDK in detail.
- **Development & Testing** — build, test, and proto-generation workflows.

## Monorepo layout

| Directory | Contents |
|---|---|
| `client/` | TypeScript/JavaScript SDK, published as `@zero-hub/client` on npm |
| `server/` | Go signaling server (`fasthttp`) |
| `proto/` | Protobuf definitions for client↔server communication |
| `test/` | E2E tests (Playwright + Svelte) driving the real client |
| `docs/` | Astro-based documentation site |
| `Makefile` | Root orchestration (run, test, proto-gen, e2e) |
| `AGENTS.md` | Repository development guide |

The protobuf definitions in `proto/` are the contract shared by both the Go
server and the TS client; regenerate them with `make proto-gen` after any
change.

## 1. Run the server

The server is Go. From the `server/` directory:

```bash
cd server
cp .env.example .env      # configure APP_CLIENT_SECRET at minimum
go run cmd/server.go      # listens on 0.0.0.0:8080 by default
```

`APP_CLIENT_SECRET` is required (the server refuses to start without it). See
`server/.env.example` for `APP_PORT`, `APP_HUB_STORAGE`, `APP_PEER_STORAGE`,
and `APP_TRUST_PROXY`. From the repo root you can also run
`make server-serve` (or `make server-serve-2` for a second instance on 8081).

## 2. Use the client

Install the published SDK:

```bash
npm install @zero-hub/client
```

Instantiating a client makes **no network connection** — call one of the hub
entrypoints to connect:

```typescript
import { ZeroHubClient, PeerStatus, LogLevel } from '@zero-hub/client';

const client = new ZeroHubClient(['localhost:8080'], {
  tls: false,                       // wss:// for production
  logLevel: LogLevel.Warning,
  dataChannelConfig: {
    onDataChannel: (peer, dc, isOwner) => {
      dc.onmessage = (e) => console.log('from', peer.id, e.data);
    },
  },
});

client.onHubInfo = (hubInfo) => console.log('in hub', hubInfo.id, 'as', client.myPeerId);
client.onPeerStatusChange = (peer) => {
  if (peer.status === PeerStatus.Connected) {
    console.log('peer connected', peer.id);
  }
};

// Connect and establish the mesh.
client.createHub('my-hub', { name: 'Alice' });
// ...or client.joinHub('my-hub', { name: 'Bob' });
```

For a second peer, call `joinHub` with the same hub ID. The two clients
negotiate over the server and establish a direct WebRTC data channel.

## 3. Core concepts (in one line each)

- **Hub** — a room; peers join it by ID (`createHub` / `joinHub` /
  `joinOrCreateHub`).
- **Peer** — a connected client, assigned a numeric ID by the server; the
  higher ID creates the offer to the lower ID to avoid collision.
- **Metadata** — arbitrary JSON attached to each peer and to each hub,
  delivered in the `HubInfoMessage`.
- **Topology** — pluggable strategy for how peers wire together
  (`MeshTopology` by default; `SFUTopology` for larger groups).
- **PeerStatus** — `Pending → Offering/AnswerPending → Answering/AcceptPending
  → Connected`, plus disconnect states.

## 4. Common tasks

- **Regenerate protobuf** after editing `proto/*.proto`: `make proto-gen`.
- **Run the full test cycle** (two servers + E2E): `make test-all`.
- **Run server unit tests**: `make server-test` (or `cd server && go test ./...`).
- **Run E2E tests**: `cd test && npm test` (the `pretest` step builds the
  harness; don't invoke `npx playwright test` directly).
- **Factory precommit gate**: `./.zerofactory/precommit.sh` (format, build,
  test).
