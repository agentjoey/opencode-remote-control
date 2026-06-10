<!-- src/lib/components/CommandPalette.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation'
  import { sessionList } from '$lib/stores/sessions.js'
  import { filterSessions } from '$lib/nav/filterSessions.js'

  export let open = false
  let query = ''
  let active = 0
  $: results = filterSessions($sessionList, query)
  $: if (active >= results.length) active = 0

  export function close() { open = false; query = '' }
  function choose(id: string) { goto(`/${id}/`); close() }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, results.length - 1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0) }
    if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active].id) }
  }
</script>

{#if open}
  <div class="overlay">
    <button class="backdrop" aria-label="Close" on:click={close}></button>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Switch session" tabindex="-1">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="q mono" autofocus placeholder="Search sessions…" bind:value={query} on:keydown={onKey} />
      <div class="results">
        {#each results as s, i (s.id)}
          <button class="row" class:active={i === active} on:click={() => choose(s.id)}>
            <span>{s.title ?? s.id.slice(-8)}</span>
            <span class="label">{s.agent ?? ''}</span>
          </button>
        {/each}
        {#if results.length === 0}<div class="empty label">No sessions</div>{/if}
      </div>
    </div>
  </div>
{/if}


<style>
  .overlay { position: fixed; inset: 0; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; z-index: 200; }
  .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); border: none; padding: 0; margin: 0; cursor: default; }
  .palette { position: relative; z-index: 1; width: 480px; max-width: 90vw; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: 0 16px 50px rgba(0,0,0,.6); }
  .q { width: 100%; box-sizing: border-box; background: transparent; border: none; border-bottom: 1px solid var(--border); color: var(--text); padding: 12px 14px; font-size: 14px; outline: none; }
  .results { max-height: 300px; overflow: auto; padding: 6px; }
  .row { display: flex; justify-content: space-between; width: 100%; background: transparent; border: none; color: var(--text); padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer; }
  .row.active, .row:hover { background: var(--accent-2); }
  .empty { padding: 12px; }
</style>
