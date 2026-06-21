<script lang="ts">
  import { page } from '$app/stores'
  import { tick, onMount, onDestroy } from 'svelte'
  import { feeds, cardsOf, sessionList } from '$lib/stores/sessions.js'
  import { api } from '$lib/api/client.js'
  import Card from '$lib/components/Card.svelte'
  import Composer from '$lib/components/Composer.svelte'

  let scrollEl: HTMLDivElement
  let composerEl: HTMLElement
  let lastSeen = ''
  let ro: ResizeObserver | undefined
  let vvCleanup: (() => void) | undefined
  let aborting = false
  // Whether the chat is scrolled to the bottom — gates the re-pin so the keyboard
  // opening/closing doesn't yank the view down while the user has scrolled up.
  let pinnedToBottom = true

  function pinBottom() {
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
  }
  function onChatScroll() {
    if (scrollEl) pinnedToBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80
  }

  $: sessionId = $page.params.sessionId ?? ''
  $: feed = $feeds[sessionId]
  $: cards = cardsOf(feed)
  $: session = $sessionList.find((s) => s.id === sessionId)
  $: title = session?.title || 'Untitled session'
  $: branch = session?.directory ? session.directory.replace(/\/+$/, '').split('/').pop() || '' : ''
  $: busy = (() => {
    if (!feed || feed.order.length === 0) return false
    const last = feed.byId[feed.order[feed.order.length - 1]]
    return last?.kind === 'thinking' || last?.kind === 'streaming' || last?.kind === 'think-stream'
  })()

  async function abort() {
    if (!sessionId || aborting) return
    aborting = true
    try { await api.abort(sessionId) } catch { /* ignore */ }
    finally { aborting = false }
  }

  // lastSeq increments on every card (including streaming upserts), so this
  // scrolls during streaming too — not only when the card count changes.
  $: scrollKey = `${sessionId}:${feed?.lastSeq ?? 0}:${cards.length}`
  $: if (scrollKey !== lastSeen) {
    lastSeen = scrollKey
    tick().then(() => { pinBottom(); pinnedToBottom = true })
  }

  // The composer floats over the chat (mobile), so the chat reserves its height
  // (--composer-h) plus the keyboard inset (--kb) as bottom padding — otherwise
  // the latest messages sit hidden behind the box / keyboard.
  onMount(() => {
    ro = new ResizeObserver(() => {
      if (composerEl) {
        document.documentElement.style.setProperty('--composer-h', `${composerEl.offsetHeight}px`)
        if (pinnedToBottom) pinBottom() // keep latest pinned as the box grows
      }
    })
    if (composerEl) ro.observe(composerEl)

    // The keyboard/toolbar shifts the composer via --kb; re-pin the latest message
    // above it (only when already at the bottom, so scroll-up isn't fought).
    const vv = window.visualViewport
    const onVV = () => { if (pinnedToBottom) requestAnimationFrame(pinBottom) }
    vv?.addEventListener('resize', onVV)
    vvCleanup = () => vv?.removeEventListener('resize', onVV)
  })
  onDestroy(() => { ro?.disconnect(); vvCleanup?.() })
</script>

<div class="chat" bind:this={scrollEl} on:scroll={onChatScroll}>
  <div class="sub-header">
    <div class="left">
      <span class="title">{title}</span>
      {#if branch}<span class="branch mono">{branch}</span>{/if}
    </div>
    <div class="right">
      {#if busy}
        <span class="pill running mono">
          <span class="dot" aria-hidden="true"></span>
          running
        </span>
        <button class="abort" on:click={abort} disabled={aborting}>Abort</button>
      {:else}
        <span class="idle mono">idle</span>
      {/if}
    </div>
  </div>
  <div class="stream">
    {#each cards as card (card.id)}
      <Card {card} />
    {/each}
    {#if cards.length === 0}
      <div class="empty">No messages yet — send one below.</div>
    {/if}
  </div>
</div>

<div class="composer-float" bind:this={composerEl}>
  <Composer {sessionId} />
</div>

<style>
  .chat {
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  /* Mobile: instead of a frosted panel behind the input, fade the chat content to
     low-brightness as it scrolls down into the composer zone — text "passes under"
     the input and dims out. Pure mask, no blur/panel. The opaque region ends a bit
     above the composer top so the latest message stays fully bright. */
  @media (max-width: 820px) {
    .chat {
      -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - var(--kb, 0px) - var(--composer-h, 120px)), rgba(0,0,0,0.12) calc(100% - var(--kb, 0px)));
      mask-image: linear-gradient(to bottom, #000 calc(100% - var(--kb, 0px) - var(--composer-h, 120px)), rgba(0,0,0,0.12) calc(100% - var(--kb, 0px)));
    }
  }

  .sub-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    max-width: 780px;
    margin: 0 auto;
    padding: 11px 24px;
    border-bottom: 1px solid var(--border-2);
  }
  .sub-header .left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .sub-header .title {
    font-size: 14px;
    font-weight: 650;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub-header .branch {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--hl-purple);
    background: var(--bg-elev);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-pill);
    padding: 2px 8px;
  }
  .sub-header .right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 9px;
    border-radius: var(--radius-pill);
    background: var(--accent-2);
    color: var(--accent);
    font-size: 11px;
  }
  .pill .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
    animation: ocrc-pulse 1.2s ease-in-out infinite;
  }
  .idle {
    font-size: 11px;
    color: var(--text-3);
  }
  .abort {
    background: transparent;
    border: 1px solid var(--border-2);
    color: var(--text-3);
    border-radius: var(--radius-sm);
    padding: 3px 10px;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: color .15s ease, border-color .15s ease;
  }
  .abort:hover { color: var(--err); border-color: var(--err); }
  .abort:disabled { opacity: .5; cursor: default; }

  .stream {
    max-width: 780px;
    margin: 0 auto;
    padding: 22px 24px 8px;
    display: flex;
    flex-direction: column;
  }
  .empty {
    color: var(--text-3);
    text-align: center;
    padding: 56px 0;
    font-size: 14px;
  }

  /* Desktop: composer is a normal in-flow bar at the bottom (unchanged). */
  /* Mobile: the input box just floats (its original form, Composer.svelte); no
     frosted panel. The dim effect comes from the .chat fade mask above. */
  @media (max-width: 820px) {
    .composer-float {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      z-index: 5;
      background: transparent;
      /* (B) Follow the keyboard/toolbar by translating up --kb on the GPU — no app
         resize, no reflow. The transition makes the snap-back (and open) glide. */
      transform: translateY(calc(-1 * var(--kb, 0px)));
      transition: transform .25s ease-out;
      will-change: transform;
    }
    .composer-float :global(.composer) { background: transparent; }
    /* Reserve the floating composer's height + keyboard inset so the latest
       message clears it (otherwise it's hidden behind the box / keyboard). */
    .stream { padding: 14px 12px calc(var(--composer-h, 120px) + var(--kb, 0px) + 8px); }
    .sub-header { padding: 11px 12px; }
  }
</style>
