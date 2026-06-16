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

  $: sessionId = $page.params.sessionId ?? ''
  $: feed = $feeds[sessionId]
  $: cards = cardsOf(feed)
  // lastSeq increments on every card (including streaming upserts), so this
  // scrolls during streaming too — not only when the card count changes.
  $: scrollKey = `${sessionId}:${feed?.lastSeq ?? 0}:${cards.length}`
  $: if (scrollKey !== lastSeen) {
    lastSeen = scrollKey
    tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
    })
  }

  // The composer floats over the chat (mobile). Track its height so the chat can
  // reserve room below the last message — content scrolls under the frosted bar.
  onMount(() => {
    ro = new ResizeObserver(() => {
      if (composerEl) document.documentElement.style.setProperty('--composer-h', `${composerEl.offsetHeight}px`)
    })
    if (composerEl) ro.observe(composerEl)
  })
  onDestroy(() => ro?.disconnect())
</script>

<div class="chat" bind:this={scrollEl}>
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
  /* Mobile: the chat fills the full height and the composer floats over it as a
     frosted bar — content scrolls under it, all the way to the screen bottom. */
  @media (max-width: 820px) {
    .composer-float {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      z-index: 5;
      background: rgba(11, 12, 14, 0.55);
      -webkit-backdrop-filter: blur(18px) saturate(180%);
      backdrop-filter: blur(18px) saturate(180%);
      border-top: 1px solid rgba(255, 255, 255, 0.06);
    }
    /* Let the frosted wrapper provide the background; the bar itself is clear. */
    .composer-float :global(.composer) { background: transparent; }
    /* Reserve room below the last message = composer height (+ a small gap). */
    .stream { padding: 14px 12px calc(var(--composer-h, 110px) + 8px); }
  }
</style>
