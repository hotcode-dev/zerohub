---
type: quickstart
title: ZeroHub Quickstart
description: What ZeroHub is, the monorepo layout, and how to run the signaling server and instantiate the TypeScript/JavaScript client to establish a peer-to-peer WebRTC connection.
tags: [quickstart, getting-started, monorepo, server, client]
sources:
  - id: openwiki-source-8037e2358a2c4f9b2c722a11
    resource: repo://AGENTS.md
  - id: openwiki-source-ce2b753bb7cfd4f636edd856
    resource: repo://client/src/index.ts
  - id: openwiki-source-718b618612c033c4f36b3a45
    resource: repo://client/src/zeroHub.ts
  - id: openwiki-source-012f2c78e3b1446dfc35803f
    resource: repo://Makefile
  - id: openwiki-source-41f21ee88395963644de9448
    resource: repo://server/pkg/config/config.go
  - id: openwiki-source-e27a23c64f72b7d3d77630c6
    resource: repo://server/pkg/handler/handler.go
  - id: openwiki-source-93a30dd3c2c7599eb46400a4
    resource: repo://test/harness/index.ts
  - id: openwiki-source-b7181b4d7359d016a13b092d
    resource: repo://test/package.json
  - id: openwiki-source-bb910847e63080c9ced0e830
    resource: repo://test/playwright.config.ts
  - id: openwiki-source-801ca2739d5984913a9ac0eb
    resource: repo://test/unit-harness/index.ts
generated: { by: "hermes", at: "2026-11-22T02:25:29.470Z" }
verified:
  - by: openwiki/0.6.0
    at: 2026-11-23T15:56:00.462Z
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
- **Go Signaling Server** — the server subsystem in detail (including
  IP-based hub routing via `JoinOrCreateHubIP`).
- **TypeScript Client SDK** — the `@zero-hub/client` SDK in detail (including
  the `joinIPHub` client method for IP-keyed hubs).
- **Development & Testing** — build, test, and proto-generation workflows.

## Monorepo layout

| Directory | Contents |
|---|---|
| `client/` | TypeScript/JavaScript SDK, published as `@zero-hub/client` on npm |
| `server/` | Go signaling server (`fasthttp`) |
| `proto/` | Protobuf definitions for client↔server communication |
| `test/` | E2E tests (Playwright driving an esbuild-bundled TypeScript harness), plus unit specs that exercise client internals with a mocked `WebSocket` and `RTCPeerConnection` |
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
entrypoints to connect. They return `Promise<void>` that resolves when the
signaling WebSocket opens (hub state like `myPeerId`/`peers` fills in when
`onHubInfo` fires):

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

// Create a random hub (the server picks the id) and establish the mesh:
// await client.createRandomHub({ name: 'Alice' });
// ...a second peer joins that hub by the id it got from onHubInfo:
// await client.joinRandomHub(hubId, { name: 'Bob' });
// Or join a static (named, never-expires) hub — static hubs are created
// out-of-band via the admin-gated /v1/static-hubs/create endpoint:
// await client.joinStaticHub('my-hub', { name: 'Bob' });
```

For a second peer, call `joinRandomHub` with the hub ID from the first
peer's `onHubInfo` callback (or `joinStaticHub` for a named, never-expires
hub created out-of-band by an admin). The two clients
negotiate over the server and establish a direct WebRTC data channel.

> Manual SDP handling: set `autoAnswer: false` / `autoAcceptAnswer: false` to
> surface incoming offers/answers via the `onOffer` / `onAnswer` callbacks and
> complete the exchange yourself with `sendAnswer` / `acceptAnswer` (see
> [TypeScript Client SDK](subsystems/client-sdk.md)).

## 3. Core concepts (in one line each)

- **Hub** — a room; peers join it by hub ID (`createRandomHub` /
  `joinRandomHub` for random hubs, `joinStaticHub` for named, never-expires
  hubs, `joinOrCreateIPHub` for IP-keyed hubs, and `joinIPHub` to join an
  existing IP-keyed hub by its derived id).
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
- **Run the full test cycle** (server unit tests + E2E + client vitest):
  `make test-all`.
- **Run server unit tests**: `make server-test` (or `cd server && go test ./...`).
- **Run E2E tests**: `cd test && npm test` (the `pretest` step type-checks and
  builds both the E2E harness and the unit-spec harness with the single
  parameterized esbuild script (`test/scripts/build-harness.mjs`) before
  invoking Playwright; don't invoke `npx playwright test` directly).
- **Factory precommit gate**: `./.zerofactory/precommit.sh` (format, build,
  test).
