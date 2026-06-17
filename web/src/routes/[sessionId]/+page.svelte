<script lang="ts">
  import { page } from '$app/stores'
  import { tick, onMount, onDestroy } from 'svelte'
  import { feeds, cardsOf } from '$lib/stores/sessions.js'
  import Card from '$lib/components/Card.svelte'
  import Composer from '$lib/components/Composer.svelte'

  let scrollEl: HTMLDivElement
  let composerEl: HTMLElement
  let lastSeen = ''
  let ro: ResizeObserver | undefined
  let vvCleanup: (() => void) | undefined
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
  .stream {
    max-width: 760px;
    margin: 0 auto;
    padding: 24px 24px 8px;
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
  }
</style>
