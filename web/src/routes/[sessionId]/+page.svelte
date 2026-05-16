<script lang="ts">
  import { page } from '$app/stores'
  import { tick } from 'svelte'
  import { cardsBySession, activeSession } from '$lib/stores/sessions.js'
  import Card from '$lib/components/Card.svelte'
  import Composer from '$lib/components/Composer.svelte'

  let scrollEl: HTMLDivElement

  $: sessionId = $page.params.sessionId
  $: cards = $cardsBySession[sessionId] ?? []
  $: {
    sessionId
    tick().then(() => {
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight
    })
  }
</script>

<div class="chat" bind:this={scrollEl}>
  {#each cards as card (card.kind + ('sessionId' in card ? card.sessionId : '') + ('ts' in card ? card.ts : '') + ('message' in card ? card.message : ''))}
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
