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
  /**
   * Target session this message should be relayed into. Web sets it to the
   * session the UI is viewing; Telegram leaves it unset and the relay falls
   * back to the (global) pinned/last session. The relay validates it exists.
   */
  sessionId?: string
}

export interface ChannelCapabilities {
  readonly edit: boolean
  readonly maxMessageLength: number
  readonly buttons: boolean
  readonly richText: boolean
  readonly streaming: boolean
}
