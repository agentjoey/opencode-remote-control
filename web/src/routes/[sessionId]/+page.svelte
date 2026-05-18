<script lang="ts">
  import { page } from '$app/stores'
  import { tick } from 'svelte'
  import { cardsBySession } from '$lib/stores/sessions.js'
  import Card from '$lib/components/Card.svelte'
  import Composer from '$lib/components/Composer.svelte'

  let scrollEl: HTMLDivElement
  let lastCount = 0

  $: sessionId = $page.params.sessionId
  $: cards = $cardsBySession[sessionId] ?? []

  // Scroll-to-bottom when new cards arrive (WI-06). Depending on sessionId
  // alone re-scrolled on every tab focus / mount even when cards were unchanged.
  $: if (cards.length !== lastCount) {
    lastCount = cards.length
    tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
    })
  }
</script>

<div class="chat" bind:this={scrollEl}>
  {#each cards as card, i (i)}
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
