<script lang="ts">
  import { connection } from '../stores/connection.js'
</script>

<span class="badge {$connection}">
  <span class="dot"></span>
  {#if $connection === 'connected'}connected
  {:else if $connection === 'reconnecting'}reconnecting…
  {:else}offline{/if}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78em;
    color: var(--text-3);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-3);
    flex-shrink: 0;
  }
  .badge.connected { color: var(--text-2); }
  .badge.connected .dot { background: var(--accent); box-shadow: 0 0 6px var(--accent); }
  .badge.reconnecting .dot { background: var(--warn); }
  .badge.offline .dot { background: var(--err); }
</style>
