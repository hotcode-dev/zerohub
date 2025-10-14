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
