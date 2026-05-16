export interface Card {
  title?: string
  lines: string[]
  buttons?: Button[][]
  footer?: string
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
