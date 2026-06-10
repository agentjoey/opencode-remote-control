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
  import ConnectionBadge from '$lib/components/ConnectionBadge.svelte'
  import OfflineBanner from '$lib/components/OfflineBanner.svelte'
  import SessionRail from '$lib/components/SessionRail.svelte'
  import Inspector from '$lib/components/Inspector.svelte'
  import CommandPalette from '$lib/components/CommandPalette.svelte'
  let paletteOpen = false
  function onGlobalKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen = true }
  }

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

<svelte:window on:keydown={onGlobalKey} />

<div class="app">
  <header class="titlebar">
    <span class="brand">OCRC</span>
    <span class="sep mono">▸ {$page.params.sessionId ? '…' + $page.params.sessionId.slice(-8) : 'no session'}</span>
    <ConnectionBadge />
    {#if installEvent}<button class="install" on:click={install}>Install</button>{/if}
    <span class="email">{email}</span>
  </header>
  <OfflineBanner />
  <div class="body">
    <SessionRail activeId={$page.params.sessionId} />
    <main><slot /></main>
    <Inspector sessionId={$page.params.sessionId} />
  </div>
</div>
<CommandPalette bind:open={paletteOpen} />

<style>
  .app { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--bg); }
  .titlebar { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); background: var(--bg-panel); flex-shrink: 0; font-size: 13px; }
  .brand { font-weight: 800; color: var(--accent); letter-spacing: .08em; font-size: 14px; }
  .sep { color: var(--text-3); }
  .email { margin-left: auto; font-size: 0.8em; color: var(--text-3); }
  .install { background: var(--accent); color: var(--accent-ink); border: none; border-radius: var(--radius-sm); padding: 4px 12px; font-size: 0.8em; font-weight: 600; cursor: pointer; }
  .body { display: flex; flex: 1; overflow: hidden; }
  main { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
</style>
