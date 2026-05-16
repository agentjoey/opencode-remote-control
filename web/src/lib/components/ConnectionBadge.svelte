<script lang="ts">
  import { connection } from '../stores/connection.js'
</script>

<span class="badge">
  {#if $connection === 'connected'}
    🟢 connected
  {:else if $connection === 'reconnecting'}
    🟡 reconnecting…
  {:else}
    🔴 offline
  {/if}
</span>

<style>
  .badge {
    font-size: 0.8em;
    color: #888;
  }
</style>
