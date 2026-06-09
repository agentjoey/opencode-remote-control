<script lang="ts">
  import { page } from '$app/stores'
  import { tick } from 'svelte'
  import { feeds, cardsOf } from '$lib/stores/sessions.js'
  import Card from '$lib/components/Card.svelte'
  import Composer from '$lib/components/Composer.svelte'

  let scrollEl: HTMLDivElement
  let lastSeen = ''

  $: sessionId = $page.params.sessionId
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
  {#each cards as card (card.id)}
    <Card {card} />
  {/each}
</div>

<Composer {sessionId} />

<style>
  .chat {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
  }
</style>
