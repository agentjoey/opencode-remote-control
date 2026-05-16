import type { Card, IncomingMessage, ChannelCapabilities } from '../core/types.js'

export interface Transport {
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
