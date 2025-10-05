# ZeroHub SDK

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
