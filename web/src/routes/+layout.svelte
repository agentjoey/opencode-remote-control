<script lang="ts">
  import { onMount } from 'svelte'
  import { page } from '$app/stores'
  import { afterNavigate } from '$app/navigation'
  import { api } from '$lib/api/client.js'
  import { createWsClient } from '$lib/ws/client.js'
  import { sessionList, cardsBySession, appendCard, setHistory } from '$lib/stores/sessions.js'
  import { connection } from '$lib/stores/connection.js'
  import SessionList from '$lib/components/SessionList.svelte'
  import ConnectionBadge from '$lib/components/ConnectionBadge.svelte'
  import ApprovalModal from '$lib/components/ApprovalModal.svelte'
  import type { StructuredCard } from '$lib/api/types.js'

  let email = ''
  let wsClient: ReturnType<typeof createWsClient> | null = null
  let pendingApproval: StructuredCard | null = null
  let lastLoaded: string | null = null

  function loadSession(id: string | undefined) {
    if (!id || id === lastLoaded) return
    lastLoaded = id
    api.history(id)
      .then((cards) => setHistory(id, cards))
      .catch((err) => console.warn('[layout] history failed', err))
    wsClient?.send({ type: 'subscribe', sessionId: id })
  }

  onMount(() => {
    api.me().then((m) => { email = m.email }).catch(() => {})
    api.sessions().then((list) => { sessionList.set(list) }).catch(() => {})

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    wsClient = createWsClient({
      url: `${protocol}//${location.host}/ws`,
      // On reconnect, re-send subscribe directly — loadSession() would
      // early-return because lastLoaded already equals the current session id.
      onReconnect: () => {
        if (lastLoaded) wsClient?.send({ type: 'subscribe', sessionId: lastLoaded })
      },
      onMessage: (msg) => {
        if (msg.type === 'card' && msg.card) {
          appendCard(msg.card)
          if (msg.card.kind === 'approval') {
            pendingApproval = msg.card
          }
        }
        if (msg.type === 'sessions' && msg.sessions) {
          sessionList.set(msg.sessions)
        }
      },
    })

    // afterNavigate doesn't fire for the first page load — handle it here.
    loadSession($page.params.sessionId)

    return () => {
      wsClient?.close()
    }
  })

  // afterNavigate runs after each client-side navigation completes,
  // so it never collides with the navigation's own page-store updates
  // (which used to cause an effect-update loop in the previous design).
  afterNavigate((nav: { to: { params: Record<string, string> } | null }) => {
    loadSession(nav.to?.params?.sessionId)
  })
</script>

<div class="app">
  <header>
    <span class="brand">ocrc</span>
    <ConnectionBadge />
    <span class="email">{email}</span>
  </header>

  <div class="body">
    <SessionList activeId={$page.params.sessionId} />
    <main>
      <slot />
    </main>
  </div>

  {#if pendingApproval && pendingApproval.kind === 'approval'}
    <ApprovalModal card={pendingApproval} onClose={() => (pendingApproval = null)} />
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    background: #0a0a0a;
    color: #eee;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
  }
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid #222;
    background: #0f0f0f;
    flex-shrink: 0;
  }
  .brand {
    font-weight: 700;
    font-size: 1.1em;
    color: #fff;
  }
  .email {
    margin-left: auto;
    font-size: 0.85em;
    color: #888;
  }
  .body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }
  main {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }
</style>
