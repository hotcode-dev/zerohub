# ZeroHub SDK

The ZeroHub SDK provides a client for connecting to a ZeroHub server and establishing peer-to-peer connections using WebRTC.

## Installation

You can install the ZeroHub SDK using npm:

```bash
npm install @zerohub/client
```

## Usage

Here's a basic example of how to use the `ZeroHubClient` to create a new hub and connect to it:

```typescript
import { ZeroHubClient } from '@zerohub/client';

// Create a new ZeroHub client
const client = new ZeroHubClient(['localhost:8080'], { tls: false });

// Create a new hub
client.createHub('my-hub');

// Listen for hub info changes
client.onHubInfo = (hubInfo) => {
  console.log('Hub info:', hubInfo);
};

// Listen for peer status changes
client.onPeerStatusChange = (peer) => {
  console.log('Peer status change:', peer);
};
```

For more advanced usage, please refer to the documentation in the source code.

## Development

### Code Quality

This project uses ESLint 9.x (flat config) and Prettier to maintain code quality and consistent formatting.

#### Available Scripts

```bash
# Lint the code
npm run lint

# Lint and fix auto-fixable issues
npm run lint:fix

# Check code formatting
npm run format:check

# Format the code
npm run format

# Run all checks (lint + format + TypeScript compilation)
npm run check

# Fix all auto-fixable issues (lint + format)
npm run fix
```

#### IDE Integration

If you're using VS Code, install these extensions:
- ESLint (`ms-vscode.vscode-eslint`)
- Prettier (`esbenp.prettier-vscode`)

The project includes VS Code settings that will automatically format code on save and run ESLint fixes.
