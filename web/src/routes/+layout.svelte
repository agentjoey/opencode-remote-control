<script lang="ts">
  import '$lib/theme.css'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { page } from '$app/stores'
  import { afterNavigate } from '$app/navigation'
  import { api } from '$lib/api/client.js'
  import { createWsClient } from '$lib/ws/client.js'
  import { sessionList, feeds, upsertCard, setHistory } from '$lib/stores/sessions.js'
  import { connection } from '$lib/stores/connection.js'
  import SessionList from '$lib/components/SessionList.svelte'
  import ConnectionBadge from '$lib/components/ConnectionBadge.svelte'
  import OfflineBanner from '$lib/components/OfflineBanner.svelte'
  import ApprovalModal from '$lib/components/ApprovalModal.svelte'
  import type { StructuredCard } from '$lib/api/types.js'

  let email = ''
  let wsClient: ReturnType<typeof createWsClient> | null = null
  // PWA install affordance (Chromium fires beforeinstallprompt when installable).
  let installEvent: any = null
  async function install() {
    if (!installEvent) return
    installEvent.prompt()
    await installEvent.userChoice
    installEvent = null
  }
  // FIFO queue — multiple approvals can be in flight; show them one at a time.
  let approvalQueue: StructuredCard[] = []
  $: pendingApproval = approvalQueue[0] ?? null
  let lastLoaded: string | null = null

  function loadSession(id: string | undefined) {
    if (!id || id === lastLoaded) return
    lastLoaded = id
    api.history(id)
      .then(({ cards, lastSeq }) => {
        setHistory(id, cards, lastSeq)
        // Subscribe with sinceSeq so the WS replays only cards published after
        // this snapshot — no gap, no duplicate.
        wsClient?.send({ type: 'subscribe', sessionId: id, sinceSeq: lastSeq })
      })
      .catch((err) => {
        console.warn('[layout] history failed', err)
        wsClient?.send({ type: 'subscribe', sessionId: id })
      })
  }

  onMount(() => {
    api.me().then((m) => { email = m.email }).catch(() => {})
    api.sessions().then((list) => { sessionList.set(list) }).catch(() => {})

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    wsClient = createWsClient({
      url: `${protocol}//${location.host}/ws`,
      // On reconnect, re-subscribe with the feed's current lastSeq so the WS
      // replays only what we missed while disconnected.
      onReconnect: () => {
        if (lastLoaded) {
          const sinceSeq = get(feeds)[lastLoaded]?.lastSeq ?? 0
          wsClient?.send({ type: 'subscribe', sessionId: lastLoaded, sinceSeq })
        }
      },
      onMessage: (msg) => {
        if (msg.type === 'card' && msg.card) {
          upsertCard(msg.card)
          if (msg.card.kind === 'approval') {
            // de-dupe by requestId, then enqueue
            if (!approvalQueue.some((c) => (c as any).requestId === msg.card.requestId)) {
              approvalQueue = [...approvalQueue, msg.card]
            }
          }
        }
        // hello (on connect) and sessions (live updates) both carry the list.
        if ((msg.type === 'hello' || msg.type === 'sessions') && msg.sessions) {
          sessionList.set(msg.sessions)
        }
        // replayEnd: buffered catch-up done; nothing to do (cards already applied).
      },
    })

    // afterNavigate doesn't fire for the first page load — handle it here.
    loadSession($page.params.sessionId)

    const onBeforeInstall = (e: Event) => { e.preventDefault(); installEvent = e }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      wsClient?.close()
    }
  })

  // afterNavigate runs after each client-side navigation completes,
  // so it never collides with the navigation's own page-store updates
  // (which used to cause an effect-update loop in the previous design).
  afterNavigate((nav) => {
    loadSession(nav.to?.params?.sessionId)
  })
</script>

<div class="app">
  <header>
    <span class="brand">ocrc</span>
    <ConnectionBadge />
    {#if installEvent}
      <button class="install" on:click={install}>Install</button>
    {/if}
    <span class="email">{email}</span>
  </header>
  <OfflineBanner />

  <div class="body">
    <SessionList activeId={$page.params.sessionId} />
    <main>
      <slot />
    </main>
  </div>

  {#if pendingApproval && pendingApproval.kind === 'approval'}
    <ApprovalModal card={pendingApproval} onClose={() => (approvalQueue = approvalQueue.slice(1))} />
  {/if}
</div>

<style>
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
  .install {
    margin-left: auto;
    background: #1e3a8a;
    color: #fff;
    border: 1px solid #2563eb;
    border-radius: 8px;
    padding: 3px 10px;
    font-size: 0.8em;
    cursor: pointer;
  }
  .install + .email { margin-left: 8px; }
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
