---
title: Server Reference
description: Reference for the ZeroHub server API and protocol messages.
---

This page documents the server-facing HTTP/WebSocket endpoints and the protobuf messages used for signaling.

## HTTP endpoints (management)

The server routes these endpoints by path only and does not check the HTTP
method, so any method reaches the handler; clients conventionally use `GET`,
which is what the AsyncAPI spec (`server/api.yml`) models.

- `GET /v1/hubs/create?id={hubId}` - create a fixed hub. Accepts optional `hubMetadata` and `peerMetadata` query params (JSON-encoded).
- `GET /v1/hubs/join?id={hubId}` - join a fixed hub
- `GET /v1/hubs/join-or-create?id={hubId}` - join an existing fixed hub or create it if it doesn't exist
- `GET /v1/hubs/get?id={hubId}` - get an existing fixed hub's metadata as plain HTTP JSON (no WebSocket upgrade, no peer roster)
- `GET /v1/random-hubs/create` - create a random hub
- `GET /v1/random-hubs/join?id={hubId}` - join a random hub
- `GET /v1/random-hubs/get?id={hubId}` - get an existing random hub's metadata as plain HTTP JSON (no WebSocket upgrade, no peer roster)
- `GET /v1/ip-hubs/join-or-create` - join or create an IP hub (server derives hubId from request IP)
- `GET /v1/permanent-hubs/join?id={hubId}` - join an existing permanent hub
- `GET /v1/permanent-hubs/create?id={hubId}` - create a permanent (never-expires) hub. Admin-gated: requires the `Authorization` header (base64 of the server's `APP_CLIENT_SECRET`). Plain HTTP (no WebSocket upgrade). Creation is out-of-band from the browser WebSocket API — browsers cannot set custom headers on a WebSocket handshake, so issue this request with a plain HTTP client (curl, `fetch` from a Node.js process), then connect with `/v1/permanent-hubs/join`.
- `GET /v1/status` - health / version endpoint (public, read-only)
- `GET /v1/admin/migrate?host={newHost}` - start a zero-downtime migration: new connections are routed to the backup host while existing ones drain; admin-gated, requires the `Authorization` header

> Note: The docs repository contains `proto/` definitions describing the WebSocket messages used by the server and client for signaling.

## WebSocket protocol

The server speaks a binary protobuf-based protocol for efficiency. The primary messages are:

- `ClientMessage` - messages sent from client to server (create/join, sendOffer, sendAnswer, etc.)
- `ServerMessage` - messages sent from server to client with hub info, offers, answers, peer join/leave notifications.

### Typical flow

1. Client connects to the WS endpoint with the hub join/create path and query params
2. Server responds with `ServerMessage.hubInfoMessage` containing peer list and assigned `myPeerId`
3. Clients exchange offers and answers via `ClientMessage.sendOfferMessage` / `ClientMessage.sendAnswerMessage` which the server forwards to the target peer

## Protobuf notes and best practices

- Messages use string-encoded JSON for `metadata` fields; keep `metadata` small to avoid large messages.
- Consider adding validation for maximum string lengths in server-side logic.
- For very high-performance scenarios, evaluate FlatBuffers but for developer ergonomics protobuf is a good default.

## Example: offer exchange

The client will send a `sendOfferMessage` containing `answerPeerId` and `offerSdp`.
The server will forward this to the target peer as a `ServerMessage.offerMessage`.

## Further reading

- See `proto/client_message.proto` and `proto/server_message.proto` in the repository
- SDK: [SDK Reference](/api-reference/sdk)
- Guides: [Hub types](/guides/hub-types)
