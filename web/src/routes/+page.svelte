<script lang="ts">
  import { goto } from '$app/navigation'
  import { browser } from '$app/environment'
  import { sessionList } from '$lib/stores/sessions.js'
  import { backends, backendName } from '$lib/stores/capabilities.js'

  // Desktop auto-opens the latest session (panel + chat both visible). On mobile the
  // dual-screen model means '/' IS the Sessions screen — redirecting into a chat would
  // skip it and make the chat header's Back button bounce straight back here.
  const isMobile = browser && window.matchMedia('(max-width: 820px)').matches
  // Auto-select the most recent session of the active agent once the list loads.
  // replaceState so Back doesn't return to this empty route.
  let redirected = false
  $: activeBackendId = $backends?.activeId
  $: agentSessions = activeBackendId
    ? $sessionList
        .filter((s) => s.backendId === activeBackendId || (!s.backendId && activeBackendId === 'opencode'))
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    : [...$sessionList].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  $: if (!redirected && !isMobile && agentSessions.length > 0) {
    redirected = true
    goto(`/${agentSessions[0].id}/`, { replaceState: true })
  }
</script>

<div class="empty">
  {#if $sessionList.length === 0}
    No sessions yet — create one to start chatting with {$backendName}.
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
