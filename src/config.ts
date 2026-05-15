import { z } from 'zod'

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  ALLOWED_USER_ID: z.string().regex(/^\d+$/, 'ALLOWED_USER_ID must be a numeric Telegram user ID').transform(Number),
  OPENCODE_BASE_URL: z.string().url().default('http://localhost:4096'),
  EDIT_THROTTLE_MS: z.string().regex(/^\d+$/).default('1000').transform(Number),
  CHAT_TIMEOUT_MS: z.string().regex(/^\d+$/).default('600000').transform(Number),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  STREAM_OUTPUT: z.string().optional().default('true').transform((v) => v === 'true'),
})

export interface Config {
  telegramBotToken: string
  allowedUserId: number
  opencodeBaseUrl: string
  editThrottleMs: number
  chatTimeoutMs: number
  logLevel: 'debug' | 'info' | 'warn' | 'error'
  streamOutput: boolean
}

export function loadConfig(): Config {
  const parsed = schema.parse(process.env)
  return {
    telegramBotToken: parsed.TELEGRAM_BOT_TOKEN,
    allowedUserId: parsed.ALLOWED_USER_ID,
    opencodeBaseUrl: parsed.OPENCODE_BASE_URL,
    editThrottleMs: parsed.EDIT_THROTTLE_MS,
    chatTimeoutMs: parsed.CHAT_TIMEOUT_MS,
    logLevel: parsed.LOG_LEVEL,
    streamOutput: parsed.STREAM_OUTPUT,
  }
}
