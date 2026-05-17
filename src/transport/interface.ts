import type { StructuredCard } from '../core/structured-card.js'
import type { CardBus } from '../core/card-bus.js'
import type { SessionState } from '../core/state.js'
import type { IncomingMessage, ChannelCapabilities } from '../core/types.js'

export interface TransportStartDeps {
  cardBus: CardBus
  state: SessionState
}

export interface Transport {
  readonly name: string
  readonly capabilities: ChannelCapabilities

  start(deps: TransportStartDeps): Promise<void>
  stop(): Promise<void>

  send(chatId: string, card: StructuredCard): Promise<{ messageId: string }>

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void
  onCommand(name: string, handler: (msg: IncomingMessage) => Promise<void>): void
  onButtonClick(handler: (data: string, msg: IncomingMessage) => Promise<void>): void
}
