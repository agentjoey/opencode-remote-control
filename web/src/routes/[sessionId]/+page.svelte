<script lang="ts">
  import { page } from '$app/stores'
  import { tick } from 'svelte'
  import { feeds, cardsOf } from '$lib/stores/sessions.js'
  import Card from '$lib/components/Card.svelte'
  import Composer from '$lib/components/Composer.svelte'

  let scrollEl: HTMLDivElement
  let lastSeen = ''

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

<Composer {sessionId} />

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
  @media (max-width: 820px) {
    .stream { padding: 14px 12px 8px; }
  }
  .empty {
    color: var(--text-3);
    text-align: center;
    padding: 56px 0;
    font-size: 14px;
  }
</style>
