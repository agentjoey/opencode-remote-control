<script lang="ts">
  import type { StructuredCard } from '../api/types.js'
  import CardUser from './CardUser.svelte'
  import CardThinking from './CardThinking.svelte'
  import CardThinkStream from './CardThinkStream.svelte'
  import CardStreaming from './CardStreaming.svelte'
  import CardAssistant from './CardAssistant.svelte'
  import CardError from './CardError.svelte'
  import CardInfo from './CardInfo.svelte'
  import CardStatus from './CardStatus.svelte'

  export let card: StructuredCard
</script>

{#if card.kind === 'user'}
  <CardUser {card} />
{:else if card.kind === 'thinking'}
  <CardThinking {card} />
{:else if card.kind === 'think-stream'}
  <CardThinkStream {card} />
{:else if card.kind === 'streaming'}
  <CardStreaming {card} />
{:else if card.kind === 'assistant'}
  <CardAssistant {card} />
{:else if card.kind === 'error'}
  <CardError {card} />
{:else if card.kind === 'info'}
  <CardInfo {card} />
{:else if card.kind === 'status'}
  <CardStatus {card} />
{:else if card.kind === 'approval'}
  <!-- Approval rendered by +layout.svelte modal -->
{:else}
  <div class="card placeholder">[{card.kind}]</div>
{/if}

<style>
  .placeholder {
    padding: 10px;
    color: #888;
    font-style: italic;
  }
</style>
