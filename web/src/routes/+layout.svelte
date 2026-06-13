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
  import { captureToken, getToken } from '$lib/auth-token.js'
  import ConnectionBadge from '$lib/components/ConnectionBadge.svelte'
  import OfflineBanner from '$lib/components/OfflineBanner.svelte'
  import SessionRail from '$lib/components/SessionRail.svelte'
  import Inspector from '$lib/components/Inspector.svelte'
  import CommandPalette from '$lib/components/CommandPalette.svelte'
  import PairGate from '$lib/components/PairGate.svelte'
  // No token (e.g. a fresh iOS home-screen PWA) → pair inside the app.
  let needsPairing = false
  let paletteOpen = false
  // Mobile off-canvas drawers (≤820px): ☰ opens sessions (left), ⓘ opens the
  // inspector (right). No effect on the desktop 3-pane layout.
  let drawerLeft = false
  let drawerRight = false
  let isMobile = false
  function closeDrawers() { drawerLeft = false; drawerRight = false }
  // ☰ / ⓘ toggle their drawer (tap again to close) and close the other.
  function toggleLeft() { drawerLeft = !drawerLeft; drawerRight = false }
  function toggleRight() { drawerRight = !drawerRight; drawerLeft = false }
  function onGlobalKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen = true }
    if (e.key === 'Escape') closeDrawers()
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
    // Capture a pairing token (#token=… in the URL) before any API/WS call, then
    // strip it from the address bar. Stored in localStorage for subsequent loads.
    captureToken()
    // No token (fresh iOS PWA launched at start_url, separate storage) → gate
    // on an in-app pairing screen instead of starting a token-less app.
    if (!getToken()) { needsPairing = true; return }

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

    // Track the mobile breakpoint so SessionRail can render in drawer mode
    // (panel-only, no spine toggle).
    const mq = window.matchMedia('(max-width: 820px)')
    isMobile = mq.matches
    const onMq = (e: MediaQueryListEvent) => { isMobile = e.matches; if (!e.matches) closeDrawers() }
    mq.addEventListener('change', onMq)

    // Drive the app height from the visual viewport so the layout always sits in
    // the visible area: the composer stays just above the iOS keyboard (no gap,
    // not covered), and the header isn't pushed under the status bar.
    const vv = window.visualViewport
    const syncVV = () => {
      if (!vv) return
      document.documentElement.style.setProperty('--app-h', `${vv.height}px`)
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      document.body.classList.toggle('kb-open', kb > 80)
    }
    syncVV()
    vv?.addEventListener('resize', syncVV)
    vv?.addEventListener('scroll', syncVV)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      mq.removeEventListener('change', onMq)
      vv?.removeEventListener('resize', syncVV)
      vv?.removeEventListener('scroll', syncVV)
      wsClient?.close()
    }
  })

  // afterNavigate runs after each client-side navigation completes,
  // so it never collides with the navigation's own page-store updates
  // (which used to cause an effect-update loop in the previous design).
  afterNavigate((nav) => {
    closeDrawers() // selecting a session in the drawer closes it
    loadSession(nav.to?.params?.sessionId)
  })
</script>

<svelte:window on:keydown={onGlobalKey} />

<div class="app">
  <header class="titlebar">
    <button class="iconbtn" class:active={drawerLeft} on:click={toggleLeft} aria-label="Sessions">☰</button>
    <span class="brand">OCRC</span>
    <button class="topsearch" on:click={() => (paletteOpen = true)} title="Search sessions & commands (⌘K)">
      <span class="ico" aria-hidden="true">⌕</span>
      <span class="ph">Search sessions & commands…</span>
    </button>
    <span class="spacer"></span>
    <ConnectionBadge />
    {#if installEvent}<button class="install" on:click={install}>Install</button>{/if}
    <button class="iconbtn" class:active={drawerRight} on:click={toggleRight} aria-label="Inspector">ⓘ</button>
    <span class="email">{email}</span>
  </header>
  <OfflineBanner />
  <div class="body">
    {#if drawerLeft || drawerRight}
      <button class="backdrop" aria-label="Close" on:click={closeDrawers}></button>
    {/if}
    <div class="rail-wrap" class:open={drawerLeft}>
      <SessionRail activeId={$page.params.sessionId} drawer={isMobile} />
    </div>
    <main><slot /></main>
    <div class="inspector-wrap" class:open={drawerRight}>
      <Inspector sessionId={$page.params.sessionId} />
    </div>
  </div>
</div>
<CommandPalette bind:open={paletteOpen} />
{#if needsPairing}<PairGate />{/if}

<style>
  .app { display: flex; flex-direction: column; height: 100vh; height: 100dvh; height: var(--app-h, 100dvh); overflow: hidden; background: var(--bg); }
  .titlebar {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px;
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
    border-bottom: 1px solid var(--border); background: var(--bg-panel);
    flex-shrink: 0; font-size: 13px;
  }
  .brand { font-weight: 800; color: var(--accent); letter-spacing: .08em; font-size: 14px; }
  .spacer { flex: 1; }
  .topsearch {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-3);
    padding: 4px 10px;
    font-size: 12px;
    cursor: text;
    min-width: 200px;
    max-width: 340px;
    transition: border-color .15s ease;
  }
  .topsearch:hover { border-color: var(--text-3); }
  .topsearch .ico { font-size: 13px; opacity: .8; }
  .email { font-size: 0.8em; color: var(--text-3); }
  .install { background: var(--accent); color: var(--accent-ink); border: none; border-radius: var(--radius-sm); padding: 4px 12px; font-size: 0.8em; font-weight: 600; cursor: pointer; }
  /* Hamburger / inspector toggles — desktop hidden, shown on mobile. */
  .iconbtn { display: none; background: transparent; border: none; color: var(--text-2); font-size: 18px; line-height: 1; padding: 4px 6px; cursor: pointer; border-radius: var(--radius-sm); }
  .iconbtn:hover { color: var(--text); background: var(--bg-elev); }
  .iconbtn.active { color: var(--accent); background: var(--accent-2); }
  .body { display: flex; flex: 1; overflow: hidden; position: relative; }
  main { flex: 1; overflow: hidden; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
  /* Drawer wrappers are transparent on desktop (SessionRail/Inspector are the
     flex children directly), and become off-canvas drawers on mobile. */
  .rail-wrap, .inspector-wrap { display: contents; }
  .backdrop { display: none; }

  @media (max-width: 820px) {
    .topsearch, .email { display: none; }
    .iconbtn { display: inline-flex; align-items: center; }
    .rail-wrap, .inspector-wrap {
      display: block;
      position: absolute; top: 0; bottom: 0; z-index: 30;
      overflow: hidden;
      transition: transform .22s ease;
      box-shadow: 0 0 40px rgba(0,0,0,.55);
    }
    .rail-wrap { left: 0; width: min(84vw, 300px); transform: translateX(-100%); }
    .inspector-wrap { right: 0; width: min(82vw, 290px); transform: translateX(100%); }
    .rail-wrap.open, .inspector-wrap.open { transform: translateX(0); }
    /* Inner components fill the drawer so its width is exactly the wrapper's,
       leaving a reliable backdrop strip to tap. */
    .rail-wrap :global(.rail), .rail-wrap :global(.panel) { width: 100%; }
    .inspector-wrap :global(.inspector) { width: 100%; }
    .backdrop {
      display: block; position: absolute; inset: 0; z-index: 20;
      background: rgba(0,0,0,.5); border: none; padding: 0; cursor: default;
      animation: fade .18s ease;
    }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  }
</style>
