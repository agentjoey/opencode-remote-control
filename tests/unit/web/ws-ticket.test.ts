import { describe, it, expect } from 'vitest'
import { mintWsTicket, verifyWsTicket } from '../../../src/transport/web/ws-ticket'

describe('ws-ticket', () => {
  it('mints a ticket that verifies once and carries the identity', async () => {
    const ticket = await mintWsTicket({ email: 'u@x', sub: 'sub_1' })
    const user = await verifyWsTicket(ticket)
    expect(user).toEqual({ email: 'u@x', sub: 'sub_1' })
  })

  it('is single-use — a second verify of the same ticket fails', async () => {
    const ticket = await mintWsTicket({ sub: 'sub_2' })
    expect(await verifyWsTicket(ticket)).not.toBeNull()
    expect(await verifyWsTicket(ticket)).toBeNull()
  })

  it('rejects garbage / foreign tokens', async () => {
    expect(await verifyWsTicket('not-a-jwt')).toBeNull()
    expect(await verifyWsTicket('a.b.c')).toBeNull()
  })
})
