<script lang="ts">
  import { onMount } from 'svelte'
  import { getExtensionConfig, serviceTokenHeaders, type ExtensionConfig } from '../lib/adapters/extension.js'
  import { setBaseUrl, setAuthHeaders, api } from '../lib/api/client.js'
  import { createWsClient } from '../lib/ws/client.js'
  import { sessionList, feeds, cardsOf, upsertCard, setHistory } from '../lib/stores/sessions.js'
  import { activeSession } from '../lib/stores/activeSession.js'
  import SessionList from '../lib/components/SessionList.svelte'
  import Card from '../lib/components/Card.svelte'
  import Composer from '../lib/components/Composer.svelte'
  import ConnectionBadge from '../lib/components/ConnectionBadge.svelte'

  // B5 option A1: the extension can't put service-token headers on a WebSocket,
  // so it authenticates REST with the CF service token and authenticates /ws
  // with a short-lived app ticket (GET /api/ws-ticket) appended as ?ticket=.
  // (/ws must be on a CF Access bypass so the upgrade reaches this app.)
  let scrollEl: HTMLDivElement
  let configured = false
  let error = ''
  let wsClient: ReturnType<typeof createWsClient> | null = null

  function subscribe(id: string) {
    const sinceSeq = $feeds[id]?.lastSeq ?? 0
    wsClient?.send({ type: 'subscribe', sessionId: id, sinceSeq })
  }

  function handleSelect(id: string) {
    activeSession.set(id)
    api.history(id)
      .then(({ cards, lastSeq }) => {
        setHistory(id, cards, lastSeq)
        subscribe(id)
      })
      .catch(console.warn)
  }

  onMount(() => {
    // Async setup in an inner IIFE so onMount returns a *synchronous* cleanup.
    void (async () => {
      try {
        const cfg: ExtensionConfig = await getExtensionConfig()
        setBaseUrl(cfg.botUrl)
        setAuthHeaders(() => serviceTokenHeaders(cfg))
        configured = true

        wsClient = createWsClient({
          url: `${cfg.botUrl.replace(/^http/, 'ws')}/ws`,
          getTicket: async () => {
            try { return (await api.wsTicket()).ticket } catch { return null }
          },
          onReconnect: () => {
            const id = $activeSession
            if (id) subscribe(id)
          },
          onMessage: (msg) => {
            if ((msg.type === 'hello' || msg.type === 'sessions') && msg.sessions) {
              sessionList.set(msg.sessions)
            } else if (msg.type === 'card' && msg.card) {
              upsertCard(msg.card)
            }
          },
        })

        api.sessions().then((list) => { sessionList.set(list) }).catch(() => {})
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
      wsClient?.close()
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
