<script lang="ts">
  import '$lib/theme.css'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { page } from '$app/stores'
  import { afterNavigate } from '$app/navigation'
  import { api } from '$lib/api/client.js'
  import { createWsClient } from '$lib/ws/client.js'
  import { sessionList, feeds, upsertCard, setHistory } from '$lib/stores/sessions.js'
  import { capabilities, loadCapabilities, backends, loadBackends, viewedSessionId, applyAgentTheme } from '$lib/stores/capabilities.js'
  import { paletteOpen } from '$lib/stores/palette.js'
  import { leftPanelOpen, plusMenuOpen, newSessionOpen, inspectorOpen } from '$lib/stores/ui.js'
  import { captureToken, getToken } from '$lib/auth-token.js'
  import Titlebar from '$lib/components/Titlebar.svelte'
  import OfflineBanner from '$lib/components/OfflineBanner.svelte'
  import AgentPanel from '$lib/components/AgentPanel.svelte'
  import Inspector from '$lib/components/Inspector.svelte'
  import CommandPalette from '$lib/components/CommandPalette.svelte'
  import NewSessionModal from '$lib/components/NewSessionModal.svelte'
  import PlusMenu from '$lib/components/PlusMenu.svelte'
  import MobileFab from '$lib/components/MobileFab.svelte'
  import PairGate from '$lib/components/PairGate.svelte'
  // No token (e.g. a fresh iOS home-screen PWA) → pair inside the app.
  let needsPairing = false
  // Mobile off-canvas drawers (≤820px): ☰ opens sessions (left), ⓘ opens the
  // inspector (right). No effect on the desktop 3-pane layout.
  let drawerLeft = false
  let isMobile = false
  let appEl: HTMLElement // the 100vh app shell — its height is the full-screen reference for --kb
  let newButtonAnchor: HTMLElement | null = null
  function closeDrawers() { drawerLeft = false; inspectorOpen.set(false) }
  // The left rail drawer and the inspector sheet are mutually exclusive on mobile.
  function toggleLeft() { drawerLeft = !drawerLeft; inspectorOpen.set(false) }
  function toggleRight() { inspectorOpen.update((v) => !v); drawerLeft = false }
  function onGlobalKey(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); paletteOpen.set(true); return }
    if (e.key === 'Escape') {
      if (get(plusMenuOpen)) { plusMenuOpen.set(false); return }
      if (get(newSessionOpen)) { newSessionOpen.set(false); return }
      closeDrawers()
    }
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
    // Capability gating keys off the viewed session's backend.
    viewedSessionId.set(id)
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
    loadCapabilities()
    loadBackends()

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

    // Track the mobile breakpoint so AgentPanel can render in drawer mode
    // (panel-only, no spine toggle).
    const mq = window.matchMedia('(max-width: 820px)')
    isMobile = mq.matches
    const onMq = (e: MediaQueryListEvent) => { isMobile = e.matches; if (!e.matches) closeDrawers() }
    mq.addEventListener('change', onMq)

    // (B) Keyboard-follow by TRANSLATING THE COMPOSER, not resizing the app.
    // .app stays a constant 100vh (no per-frame reflow); we publish --kb = how
    // much the bottom of the visual viewport is obscured (browser toolbar and/or
    // keyboard) and the composer is transform: translateY(-kb) with a GPU
    // transition, so the follow glides. --kb is 0 at rest, so the composer sits
    // at the screen bottom (its env(safe-area-inset-bottom) padding clears the
    // home indicator). vv.height shrinks when the toolbar/keyboard appear.
    const vv = window.visualViewport
    // Full-screen reference = the .app's own 100vh height (the iOS "large
    // viewport"). NOT documentElement.clientHeight: in Safari that ≈ the visible
    // viewport (excludes the bottom toolbar), so it would miss the toolbar and the
    // composer would sit behind it. The 100vh height is constant (keyboard/toolbar
    // don't change it), so cache it and only re-measure on rotation.
    let fullH = appEl ? appEl.offsetHeight : window.innerHeight
    const setKb = () => {
      if (!vv) return
      // iOS Safari auto-scrolls the page to reveal a focused input; undo it so the
      // fixed app stays pinned and offsetTop stays ~0.
      if (window.scrollY !== 0) window.scrollTo(0, 0)
      let kb = Math.round(fullH - vv.offsetTop - vv.height)
      if (kb < 12) kb = 0 // ignore sub-pixel / negligible insets (PWA at rest)
      else kb += 5        // small gap so the box never touches the keyboard/toolbar
      document.documentElement.style.setProperty('--kb', `${kb}px`)
    }
    setKb()
    vv?.addEventListener('resize', setKb)
    vv?.addEventListener('scroll', setKb)
    // 100vh changes only on rotation; re-measure after it settles.
    const onOrient = () => setTimeout(() => { fullH = appEl ? appEl.offsetHeight : window.innerHeight; setKb() }, 300)
    window.addEventListener('orientationchange', onOrient)

    // (C) iOS fires only sparse visualViewport sizes during the keyboard
    // animation, so after a focus change re-run setKb every frame for a short
    // window — coalesced, and guaranteed to land on the final --kb (the transform
    // transition smooths the steps; we never get stuck mid-animation).
    let settleUntil = 0
    let settleRAF = 0
    const settleLoop = () => {
      setKb()
      if (Date.now() < settleUntil) settleRAF = requestAnimationFrame(settleLoop)
      else settleRAF = 0
    }
    const startSettle = () => {
      settleUntil = Date.now() + 650
      if (!settleRAF) settleRAF = requestAnimationFrame(settleLoop)
    }
    window.addEventListener('focusin', startSettle)
    window.addEventListener('focusout', startSettle)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      mq.removeEventListener('change', onMq)
      vv?.removeEventListener('resize', setKb)
      vv?.removeEventListener('scroll', setKb)
      window.removeEventListener('focusin', startSettle)
      window.removeEventListener('focusout', startSettle)
      window.removeEventListener('orientationchange', onOrient)
      if (settleRAF) cancelAnimationFrame(settleRAF)
      wsClient?.close()
    }
  })

  // Keep the chrome accent in sync with the active agent.
  $: if ($backends && typeof document !== 'undefined') {
    applyAgentTheme($backends.activeId)
  }

  // v2 mobile dual-screen: no active session → the Sessions screen (agent panel)
  // fills the viewport; selecting one navigates to the Chat screen. ☰ re-opens it.
  $: hasSession = !!$page.params.sessionId

  // afterNavigate runs after each client-side navigation completes,
  // so it never collides with the navigation's own page-store updates
  // (which used to cause an effect-update loop in the previous design).
  afterNavigate((nav) => {
    closeDrawers() // selecting a session in the drawer closes it
    loadSession(nav.to?.params?.sessionId)
  })
</script>

<svelte:window on:keydown={onGlobalKey} />

<div class="app" bind:this={appEl}>
  <!-- On mobile the chat screen has its own header (back + agent + title + inspector),
       so the global titlebar only shows on desktop and on the mobile Sessions screen. -->
  {#if !(isMobile && hasSession)}
    <Titlebar
      {email}
      onPalette={() => paletteOpen.set(true)}
      {installEvent}
      onInstall={install}
      {drawerLeft}
      drawerRight={$inspectorOpen}
      onToggleLeft={toggleLeft}
      onToggleRight={toggleRight}
      bind:newButtonAnchor
    />
  {/if}
  <OfflineBanner />
  <div class="body">
    {#if drawerLeft || $inspectorOpen}
      <button class="backdrop" aria-label="Close" on:click={closeDrawers}></button>
    {/if}
    <div class="rail-wrap" class:collapsed={!$leftPanelOpen && !isMobile} class:open={drawerLeft || (isMobile && !hasSession)}>
      <AgentPanel activeId={$page.params.sessionId} drawer={isMobile} />
    </div>
    <main><slot /></main>
    <div class="inspector-wrap" class:open={$inspectorOpen}>
      <Inspector sessionId={$page.params.sessionId} />
    </div>
  </div>
</div>
<CommandPalette open={$paletteOpen} on:close={() => paletteOpen.set(false)} />
<PlusMenu anchor={newButtonAnchor} />
<NewSessionModal />
{#if !hasSession}<MobileFab />{/if}
{#if needsPairing}<PairGate />{/if}

<style>
  /* position:fixed + JS visualViewport sizing pins the app to the visible area,
     keeping the composer above the iOS keyboard. Inline height/transform from JS
     win; the 100dvh here is the no-visualViewport fallback. */
  /* height:100vh ONLY — NOT 100dvh. On iOS standalone PWAs 100dvh is mis-sized on
     cold start (reports the screen MINUS the safe areas → a dark strip below the
     app), whereas 100vh fills the true screen and lets viewport-fit=cover give
     real env(safe-area-inset-*) values. JS overrides height only when the
     keyboard is open. */
  .app { position: fixed; top: 0; left: 0; right: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--bg); }
  .body { display: flex; flex: 1; overflow: hidden; position: relative; }
  main { position: relative; flex: 1; overflow: hidden; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
  /* Drawer wrappers hold the left panel on desktop and become off-canvas drawers on mobile. */
  .rail-wrap {
    display: block;
    width: 250px;
    flex-shrink: 0;
    overflow: hidden;
    transition: width .22s ease;
  }
  .rail-wrap.collapsed { width: 0; }
  .inspector-wrap { display: contents; }
  .backdrop { display: none; }

  @media (max-width: 820px) {
    /* v2 dual-screen: the agent panel is a FULL-SCREEN Sessions screen, shown when
       there's no active session (or ☰), and slid away to reveal the Chat screen. */
    .rail-wrap {
      display: block;
      position: absolute; top: 0; bottom: 0; left: 0; z-index: 30;
      width: 100%;
      overflow: hidden;
      transition: transform .24s ease;
      transform: translateX(-100%);
    }
    .rail-wrap.collapsed { width: 100%; }
    .rail-wrap.open { transform: translateX(0); }

    /* Inspector = bottom sheet (rises over a scrim) per v2 mobile. */
    .inspector-wrap {
      display: block;
      position: absolute; left: 0; right: 0; bottom: 0; top: auto; z-index: 35;
      width: 100%; height: min(82vh, 580px);
      overflow: hidden;
      transition: transform .24s ease;
      transform: translateY(100%);
      border-radius: 18px 18px 0 0;
      box-shadow: 0 -10px 44px rgba(0,0,0,.55);
    }
    .inspector-wrap.open { transform: translateY(0); }

    .rail-wrap :global(.agent-panel), .rail-wrap :global(.panel) { width: 100%; }
    .inspector-wrap :global(.inspector) { width: 100%; height: 100%; }
    /* MUST sit below the rail (30) AND the inspector sheet (35) so taps on an open
       drawer hit the drawer, not the backdrop. It only dims the content behind. */
    .backdrop {
      display: block; position: absolute; inset: 0; z-index: 25;
      background: rgba(0,0,0,.5); border: none; padding: 0; cursor: default;
      animation: fade .18s ease;
    }
    @keyframes fade { from { opacity: 0; } to { opacity: 1; } }
  }
</style>
