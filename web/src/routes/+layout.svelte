<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { api } from '$lib/api/client.js'
  import { createWsClient } from '$lib/ws/client.js'
  import { sessionList, cardsBySession, appendCard, setHistory } from '$lib/stores/sessions.js'
  import { activeSession } from '$lib/stores/activeSession.js'
  import { connection } from '$lib/stores/connection.js'
  import SessionList from '$lib/components/SessionList.svelte'
  import ConnectionBadge from '$lib/components/ConnectionBadge.svelte'
  import ApprovalModal from '$lib/components/ApprovalModal.svelte'
  import type { StructuredCard } from '$lib/api/types.js'

  let email = ''
  let wsClient: ReturnType<typeof createWsClient> | null = null
  let pendingApproval: StructuredCard | null = null

  onMount(() => {
    api.me().then((m) => { email = m.email }).catch(() => {})
    api.sessions().then((list) => { sessionList.set(list) }).catch(() => {})

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    wsClient = createWsClient({
      url: `${protocol}//${location.host}/ws`,
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

    const unsub = activeSession.subscribe((id) => {
      if (!id) return
      api.history(id).then((cards) => setHistory(id, cards)).catch(() => {})
      wsClient?.send({ type: 'subscribe', sessionId: id })
      if ($page.params.sessionId !== id) {
        goto(`/${id}/`)
      }
    })

    // redirect to first session if none active
    const unsubList = sessionList.subscribe((list) => {
      if (!$activeSession && list.length > 0) {
        activeSession.set(list[0].id)
      }
    })

    return () => {
      unsub()
      unsubList()
      wsClient?.close()
    }
  })
</script>

<div class="app">
  <header>
    <span class="brand">oprc</span>
    <ConnectionBadge />
    <span class="email">{email}</span>
  </header>

  <div class="body">
    <SessionList />
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
