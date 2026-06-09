<script lang="ts">
  import { onMount } from 'svelte'
  import { getExtensionConfig, serviceTokenHeaders, type ExtensionConfig } from '../lib/adapters/extension.js'
  import { setBaseUrl, setAuthHeaders, api } from '../lib/api/client.js'
  import { sessionList, feeds, cardsOf, setHistory } from '../lib/stores/sessions.js'
  import { activeSession } from '../lib/stores/activeSession.js'
  import { connection } from '../lib/stores/connection.js'
  import SessionList from '../lib/components/SessionList.svelte'
  import Card from '../lib/components/Card.svelte'
  import Composer from '../lib/components/Composer.svelte'
  import ConnectionBadge from '../lib/components/ConnectionBadge.svelte'

  // B5 option A2: a Chrome extension can't put service-token headers on a
  // WebSocket handshake, so the extension authenticates REST with the CF Access
  // service token and polls /api/session/:id instead of streaming over WS.
  const POLL_MS = 2500
  const SESSIONS_EVERY = 4 // refresh the session list every Nth poll

  let scrollEl: HTMLDivElement
  let configured = false
  let error = ''
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let tick = 0
  // Skip setHistory when nothing changed (avoids needless re-render).
  let lastSig = ''

  function handleSelect(id: string) {
    activeSession.set(id)
    lastSig = ''
    void pollActive()
  }

  function historySig(cards: any[]): string {
    const last = cards[cards.length - 1]
    const tail = last?.blocks?.[last.blocks.length - 1]?.text ?? last?.text ?? ''
    return `${cards.length}:${last?.kind ?? ''}:${tail.length}`
  }

  async function pollActive() {
    const id = $activeSession
    if (!id) return
    try {
      const { cards, lastSeq } = await api.history(id)
      connection.set('connected')
      const sig = historySig(cards)
      if (sig !== lastSig) {
        lastSig = sig
        setHistory(id, cards, lastSeq)
      }
    } catch {
      connection.set('reconnecting')
    }
  }

  async function pollSessions() {
    try {
      sessionList.set(await api.sessions())
      connection.set('connected')
    } catch {
      connection.set('reconnecting')
    }
  }

  onMount(() => {
    // Async setup in an inner IIFE so onMount returns a *synchronous* cleanup.
    void (async () => {
      try {
        const cfg: ExtensionConfig = await getExtensionConfig()
        setBaseUrl(cfg.botUrl)
        setAuthHeaders(() => serviceTokenHeaders(cfg))
        configured = true

        await pollSessions()
        pollTimer = setInterval(() => {
          tick += 1
          void pollActive()
          if (tick % SESSIONS_EVERY === 0) void pollSessions()
        }, POLL_MS)
      } catch (err) {
        error = String(err)
      }
    })()

    const listener = (msg: any) => {
      if (msg?.type === 'inject-prompt') {
        window.dispatchEvent(new CustomEvent('ocrc-inject-prompt', { detail: msg.payload }))
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => {
      if (pollTimer) clearInterval(pollTimer)
      connection.set('offline')
      chrome.runtime.onMessage.removeListener(listener)
    }
  })

  $: currentCards = $activeSession ? cardsOf($feeds[$activeSession]) : []

  $: if (scrollEl && currentCards.length) {
    setTimeout(() => { scrollEl.scrollTop = scrollEl.scrollHeight }, 50)
  }
</script>

{#if !configured}
  <div class="unconfigured">
    {#if error}
      <h2>Extension not configured</h2>
      <p>Open the extension popup and set your bot URL (and CF Access service token).</p>
      <p class="err">{error}</p>
    {:else}
      <p>Loading…</p>
    {/if}
  </div>
{:else}
  <div class="app">
    <header>
      <span class="logo">ocrc</span>
      <ConnectionBadge />
    </header>
    <div class="body">
      <aside>
        <SessionList activeId={$activeSession ?? undefined} onSelect={handleSelect} />
      </aside>
      <main>
        <div class="cards" bind:this={scrollEl}>
          {#each currentCards as card (card.id)}
            <Card {card} />
          {/each}
        </div>
        {#if $activeSession}
          <Composer sessionId={$activeSession} />
        {/if}
      </main>
    </div>
  </div>
{/if}

<style>
  .unconfigured { padding: 2rem; color: #fff; font-family: sans-serif; }
  .unconfigured h2 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  .unconfigured .err { color: #ef4444; font-size: 0.875rem; }
  .app { display: flex; flex-direction: column; height: 100vh; background: #0a0a0a; color: #e5e5e5; font-family: sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; border-bottom: 1px solid #222; }
  .logo { font-weight: 700; letter-spacing: -0.02em; }
  .body { display: flex; flex: 1; overflow: hidden; }
  aside { width: 220px; border-right: 1px solid #222; overflow-y: auto; }
  main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .cards { flex: 1; overflow-y: auto; padding: 1rem; }
</style>
