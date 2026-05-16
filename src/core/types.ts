export interface Card {
  title?: string
  lines: string[]
  buttons?: Button[][]
  footer?: string
  /** When true, lines/footer are already valid Telegram HTML — skip escaping in renderer */
  rawHtml?: boolean
}

export interface Button {
  label: string
  data: string
}

export interface IncomingMessage {
  userId: string
  chatId: string
  text: string
  messageId: string
}

export interface ChannelCapabilities {
  readonly edit: boolean
  readonly maxMessageLength: number
  readonly buttons: boolean
  readonly richText: boolean
  readonly streaming: boolean
}
