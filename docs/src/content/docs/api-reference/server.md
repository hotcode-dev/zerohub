---
title: Server Reference
description: Reference for the ZeroHub server API and protocol messages.
---

This page documents the server-facing HTTP/WebSocket endpoints and the protobuf messages used for signaling.

## HTTP endpoints (management)

- `POST /v1/hubs/create?id={hubId}` - create a fixed hub. Accepts optional `hubMetadata` and `peerMetadata` query params (JSON-encoded).
- `GET /v1/hubs/join?id={hubId}` - join a fixed hub
- `POST /v1/random-hubs/create` - create a random hub
- `GET /v1/random-hubs/join?id={hubId}` - join a random hub
- `GET /v1/ip-hubs/join-or-create` - join or create an IP hub (server derives hubId from request IP)

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
- SDK: [SDK Reference](/docs/api-reference/sdk)
- Guides: [Hub types](/docs/guides/hub-types)
