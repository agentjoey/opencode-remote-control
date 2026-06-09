<script lang="ts">
  import { goto } from '$app/navigation'
  import { sessionList } from '$lib/stores/sessions.js'

  // Auto-select the most recent session once the list loads (the layout fetches
  // it async). replaceState so Back doesn't return to this empty route.
  let redirected = false
  $: if (!redirected && $sessionList.length > 0) {
    redirected = true
    goto(`/${$sessionList[0].id}/`, { replaceState: true })
  }
</script>

<div class="empty">
  {#if $sessionList.length === 0}
    No sessions yet — start one in opencode.
  {:else}
    Opening latest session…
  {/if}
</div>

<style>
  .empty {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: #666;
  }
</style>
