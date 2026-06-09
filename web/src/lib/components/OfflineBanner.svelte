<script lang="ts">
  import { connection } from '../stores/connection.js'
</script>

{#if $connection !== 'connected'}
  <div class="banner" class:offline={$connection === 'offline'} role="status">
    {#if $connection === 'reconnecting'}
      Reconnecting…
    {:else}
      Offline — live updates paused
    {/if}
  </div>
{/if}

<style>
  .banner {
    text-align: center;
    font-size: 0.8em;
    padding: 4px 8px;
    background: #3a2f12;
    color: #fbbf24;
    border-bottom: 1px solid #4a3c18;
  }
  .banner.offline {
    background: #3a1212;
    color: #f87171;
    border-bottom-color: #4a1818;
  }
</style>
