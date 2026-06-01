# Contributing to Capix

Capix is in alpha. The most valuable contributions right now are
bug reports and feedback from real usage.

## Reporting a bug

Open an issue with:
- What you were trying to do
- What you expected to happen
- What actually happened
- Node.js version (`node --version`) and OS
- A minimal reproduction

## Running the project locally

```bash
git clone https://github.com/milanito/capix
cd capix
pnpm install
pnpm build
pnpm test
```

## Running the tests

```bash
# All packages
pnpm test

# A specific package
pnpm --filter @capixjs/core test
pnpm --filter @capixjs/transport-rest test
```

## Project structure

```
packages/
  core/                  @capixjs/core — capability, context, guards, errors, enhancers
  transports/
    rest/                @capixjs/transport-rest
    ws/                  @capixjs/transport-ws
    graphql/             @capixjs/transport-graphql
    queue/               @capixjs/transport-queue
  testing/               @capixjs/testing
  plugins/
    auth/                @capixjs/plugin-auth
    cors/                @capixjs/plugin-cors
    helmet/              @capixjs/plugin-helmet
    logging/             @capixjs/plugin-logging
cli/                     @capixjs/cli
docs/                    Documentation source (rendered by VitePress)
website/                 VitePress config and theme
benchmarks/              Performance benchmarks
```

## Before opening a PR

This project is in alpha and the architecture is still settling.
Open an issue first to discuss the change before writing code.
PRs that arrive without prior discussion may not be accepted.

## Code style

TypeScript strict mode throughout.
No `any` unless there is a comment explaining why.
Tests for all new behavior.
