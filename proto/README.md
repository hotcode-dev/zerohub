# Protocol Buffer Definitions

Protobuf definitions for client-server communication in ZeroHub.

## Files

| File | Description |
|---|---|
| `client_message.proto` | Defines `ClientMessage` — the protobuf message sent from client to server. |
| `server_message.proto` | Defines `ServerMessage` — the protobuf message sent from server to client. |

## Generated Code

- **Go**: `server/pkg/proto/zerohub/v1/`
- **TypeScript**: `client/src/proto/zerohub/v1/`

Regenerate with `make proto-gen` after any `.proto` changes.
