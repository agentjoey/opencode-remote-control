# Contributing a New Transport

This guide explains how to add a new transport (e.g., Web, Discord, Slack) to
opencode-remote-control.

## Overview

A **transport** is a channel-specific adapter that satisfies the `Transport`
interface. The core relay (`src/core/relay.ts`) is channel-agnostic — it sends
and receives messages via the transport without knowing whether the user is on
Telegram, Web, or anything else.

## The Transport interface

```typescript
interface Transport {
  readonly name: string
  readonly capabilities: ChannelCapabilities

  start(): Promise<void>
  stop(): Promise<void>

  send(chatId: string, card: Card): Promise<{ messageId: string }>
  edit(chatId: string, messageId: string, card: Card): Promise<void>
  delete(chatId: string, messageId: string): Promise<void>

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  onCommand(name: string, handler: (msg: IncomingMessage) => Promise<void>): void
  onButtonClick(handler: (data: string, msg: IncomingMessage) => Promise<void>): void
}
```

```typescript
interface ChannelCapabilities {
  readonly edit: boolean          // supports message editing
  readonly maxMessageLength: number
  readonly buttons: boolean       // supports inline buttons
  readonly richText: boolean      // supports HTML or similar
  readonly streaming: boolean     // native push vs. periodic edit
}
```

```typescript
interface Card {
  title?: string
  lines: string[]               // HTML-ish tags: <b>, <i>, <code>
  buttons?: Button[][]          // 2D array for row layout
  footer?: string
}

interface Button {
  label: string
  data: string                  // callback payload
}

interface IncomingMessage {
  userId: string
  chatId: string
  text: string
  messageId: string
}
```

## Step-by-step recipe

### 1. Create the transport directory

```bash
mkdir src/transport/<name>
```

### 2. Implement `create<Name>Transport(config): Transport`

Create `src/transport/<name>/index.ts` that exports a factory function.

Key responsibilities:
- **Honest capabilities.** Don't claim `edit: true` if your channel has no
  edit primitive. The relay will fall back to `delete + send`.
- **Incoming messages.** Wire your channel's native message events to the
  `onMessage` handler.
- **Outgoing messages.** Implement `send`, `edit`, `delete` using your
  channel's API. Translate `Card` to your native format.
- **Start/stop.** Connect and disconnect cleanly.

### 3. Register the transport in the loader

In `src/index.ts`, add your transport to the loader:

```typescript
if (config.transport === '<name>') {
  const transport = create<Name>Transport({ ... })
  // ...
}
```

### 4. Add env vars to `src/config.ts`

If your transport needs new configuration (e.g., Discord token, Web port),
add them to the zod schema and `Config` interface.

### 5. Write tests

Create `tests/unit/transport-<name>.test.ts`:

- Mock the channel's SDK/client.
- Verify `send`/`edit`/`delete` translate `Card` correctly.
- Verify `onMessage` forwards incoming messages.
- Verify capabilities are declared honestly.

### 6. Write docs

Create `docs/transports/<name>.md` with setup instructions, common errors,
and troubleshooting.

### 7. Update README

Add your transport to the "How we're different" table and the "Multi-transport
future" section.

## Example: skeleton transport

```typescript
// src/transport/fake/index.ts
import type { Transport, ChannelCapabilities } from '../interface.js'
import type { Card, IncomingMessage } from '../../core/types.js'

const CAPS: ChannelCapabilities = {
  edit: false,
  maxMessageLength: 2000,
  buttons: false,
  richText: false,
  streaming: false,
}

export function createFakeTransport(): Transport {
  let messageHandler: ((msg: IncomingMessage) => Promise<void>) | undefined

  return {
    name: 'fake',
    capabilities: CAPS,
    async start() { console.log('fake transport started') },
    async stop()  { console.log('fake transport stopped') },
    async send(chatId, card) {
      console.log('send to', chatId, card.lines.join('\n'))
      return { messageId: 'fake-1' }
    },
    async edit(chatId, messageId, card) {
      console.log('edit', messageId, card.lines.join('\n'))
    },
    async delete(chatId, messageId) {
      console.log('delete', messageId)
    },
    onMessage(h) { messageHandler = h },
    onCommand() {},
    onButtonClick() {},
  }
}
```

## Capabilities guide

| Channel | edit | maxMessageLength | buttons | richText | streaming |
|---|---|---|---|---|---|
| Telegram | ✅ | 4000 | ✅ | ✅ (HTML) | ❌ (poll/edit) |
| Web (Phase 5) | ✅ | ∞ | ✅ | ✅ (HTML/React) | ✅ (WebSocket) |
| Discord | ✅ | 2000 | ✅ | ✅ (Markdown) | ❌ |
| Slack | ✅ | 3000 | ✅ | ✅ (Mrkdwn) | ❌ |

## Questions?

Open an issue or discussion on GitHub.
