# ZeroHub Server

The ZeroHub server is a WebRTC signaling server that facilitates peer-to-peer connections.

## Architecture

The server is built using a modular architecture, with each package responsible for a specific part of the functionality:

- `cmd`: The entry point of the application.
- `pkg`: The core logic of the server.
  - `config`: Handles the configuration of the server.
  - `handler`: Implements the HTTP and WebSocket handlers.
  - `hub`: Manages the hubs and peers.
  - `logger`: Provides logging functionality.
  - `peer`: Represents a peer in the network.
  - `proto`: Contains the protobuf definitions for the client-server communication.
  - `storage`: Provides a generic storage interface and implementations.
  - `zerohub`: The main package that ties everything together.

## Getting Started

To get started with the server, you need to have Go installed. You can then run the server using the following command:

```bash
go run cmd/server.go
```

The server will start on port 8080 by default. You can change the port and other configuration options by setting the environment variables in the `.env` file.

## Deployment

The server is configured for deployment on [Fly.io](https://fly.io) via GitHub Actions ([`.github/workflows/server.yml`](../.github/workflows/server.yml)):

- **Automated CI/CD**: Pushing changes to `main` that affect `server/**` or `proto/**` runs unit tests and executes `flyctl deploy --local-only`.
- **Pull Requests**: Pull requests targeting `main` automatically run Go tests and `go vet`.
- **Health Checks**: Machine health is verified via `/v1/status` before traffic shifts.
- **Secrets**: Requires `FLY_API_TOKEN` configured in GitHub Repository Secrets. Runtime application secrets (e.g., `APP_CLIENT_SECRET`) are configured directly via `fly secrets set`.
