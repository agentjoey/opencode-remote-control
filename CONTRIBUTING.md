# Contributing to opencode-remote-control

Thank you for your interest in contributing! This document covers the basics of getting started.

## Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/<your-org>/opencode-remote-control.git
   cd opencode-remote-control
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Run tests**
   ```bash
   npm test            # unit tests
   npx tsc --noEmit    # type-check
   ```

## Development Workflow

- **Create a branch** for your change.
- **Write tests first** — we follow test-driven development (TDD).
  1. Write a failing test.
  2. Implement the minimal change to make it pass.
  3. Refactor if needed.
- **Keep commits focused** — one logical change per commit.
- **Ensure all checks pass** before opening a PR:
  ```bash
  npm run typecheck && npm test
  ```

## Testing

- Unit tests live in `tests/unit/*.test.ts`.
- Integration tests live in `tests/integration/`.
- Run `npm test` to execute the full suite.
- We use [Vitest](https://vitest.dev/) as our test runner.

## Code Style

- TypeScript with strict mode enabled.
- Follow existing patterns in the codebase.
- Keep functions small and focused.
- Use descriptive variable names.
- Add types to all public APIs.

## Adding a New Transport

See [`docs/transports/CONTRIBUTING-NEW-TRANSPORT.md`](docs/transports/CONTRIBUTING-NEW-TRANSPORT.md) for a step-by-step guide.

## Pull Requests

- Fill out the PR template.
- Link any related issues.
- Ensure CI checks pass.
- Request review from maintainers.

## Questions?

Open an issue or discussion on GitHub.
