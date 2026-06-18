<script lang="ts">
  import '$lib/theme.css'
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { page } from '$app/stores'
  import { afterNavigate, goto } from '$app/navigation'
  import { api } from '$lib/api/client.js'
  import { createWsClient } from '$lib/ws/client.js'
  import { sessionList, feeds, upsertCard, setHistory } from '$lib/stores/sessions.js'
  import { connection } from '$lib/stores/connection.js'
  import { capabilities, loadCapabilities, backends, loadBackends, setActiveBackend, viewedSessionId } from '$lib/stores/capabilities.js'
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
  let appEl: HTMLElement // the 100vh app shell — its height is the full-screen reference for --kb
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

  // Switching the backend sets where new sessions go AND moves you to that
  // backend: open its most-recent session, or start a fresh one if none exists.
  async function switchBackend(id: string) {
    await setActiveBackend(id)
    const list = get(sessionList)
    const existing = list.find((s) => s.backendId === id)
    if (existing) { goto(`/${existing.id}/`); return }
    // No session on this backend yet. ACP-style backends (no workspaces) can
    // start one with an empty directory; opencode needs a workspace, so just
    // drop to the empty state and let the user pick + New session.
    const cap = get(backends)?.backends.find((b) => b.id === id)?.capabilities
    if (cap && cap.workspaces === false) {
      try {
        const res = await api.createSession({ directory: '' })
        sessionList.set(await api.sessions())
        goto(`/${res.id}/`)
      } catch (err) { console.warn('[switch] create failed', err) }
    } else {
      goto('/')
    }
  }

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

    // Track the mobile breakpoint so SessionRail can render in drawer mode
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
  <header class="titlebar">
    <button class="iconbtn" class:active={drawerLeft} on:click={toggleLeft} aria-label="Sessions">☰</button>
    <span class="brand">OCRC</span>
    {#if $backends && $backends.backends.length > 1}
      <select
        class="backend-switch mono"
        title="Active backend for new sessions"
        value={$backends.activeId}
        on:change={(e) => switchBackend((e.currentTarget as HTMLSelectElement).value)}
      >
        {#each $backends.backends as b (b.id)}
          <option value={b.id}>{b.id}</option>
        {/each}
      </select>
    {:else if $capabilities}
      <span class="backend-chip mono" title="Backend: {$capabilities.id}">{$capabilities.id}</span>
    {/if}
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
  /* position:fixed + JS visualViewport sizing pins the app to the visible area,
     keeping the composer above the iOS keyboard. Inline height/transform from JS
     win; the 100dvh here is the no-visualViewport fallback. */
  /* height:100vh ONLY — NOT 100dvh. On iOS standalone PWAs 100dvh is mis-sized on
     cold start (reports the screen MINUS the safe areas → a dark strip below the
     app), whereas 100vh fills the true screen and lets viewport-fit=cover give
     real env(safe-area-inset-*) values. JS overrides height only when the
     keyboard is open. */
  .app { position: fixed; top: 0; left: 0; right: 0; display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: var(--bg); }
  .titlebar {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px;
    padding-top: calc(10px + env(safe-area-inset-top, 0px));
    border-bottom: 1px solid var(--border); background: var(--bg-panel);
    flex-shrink: 0; font-size: 13px;
  }
  .brand { font-weight: 800; color: var(--accent); letter-spacing: .08em; font-size: 14px; }
  .backend-chip {
    color: var(--text-3);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: lowercase;
    letter-spacing: .02em;
    white-space: nowrap;
    flex-shrink: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 120px;
  }
  .backend-switch {
    color: var(--text-2);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: .02em;
    cursor: pointer;
    max-width: 140px;
    flex-shrink: 0;
    transition: border-color .12s, color .12s;
  }
  .backend-switch:hover { border-color: var(--accent); color: var(--text); }
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
  main { position: relative; flex: 1; overflow: hidden; display: flex; flex-direction: column; min-width: 0; background: var(--bg); }
  /* Drawer wrappers are transparent on desktop (SessionRail/Inspector are the
     flex children directly), and become off-canvas drawers on mobile. */
  .rail-wrap, .inspector-wrap { display: contents; }
  .backdrop { display: none; }

  @media (max-width: 820px) {
    .topsearch, .email { display: none; }
    .iconbtn { display: inline-flex; align-items: center; justify-content: center; min-width: 40px; min-height: 40px; font-size: 20px; }
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
