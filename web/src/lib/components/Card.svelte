<script lang="ts">
  import type { StructuredCard } from '../api/types.js'
  import CardUser from './CardUser.svelte'
  import CardThinking from './CardThinking.svelte'
  import CardStreaming from './CardStreaming.svelte'
  import CardAssistant from './CardAssistant.svelte'
  import CardError from './CardError.svelte'
  import CardInfo from './CardInfo.svelte'

  export let card: StructuredCard
</script>

{#if card.kind === 'user'}
  <CardUser {card} />
{:else if card.kind === 'thinking'}
  <CardThinking {card} />
{:else if card.kind === 'streaming'}
  <CardStreaming {card} />
{:else if card.kind === 'assistant'}
  <CardAssistant {card} />
{:else if card.kind === 'error'}
  <CardError {card} />
{:else if card.kind === 'info'}
  <CardInfo {card} />
{:else if card.kind === 'approval'}
  <!-- handled by ApprovalModal -->
{/if}
