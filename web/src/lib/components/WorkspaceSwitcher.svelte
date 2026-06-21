<script lang="ts">
  import { api } from '$lib/api/client.js'
  import { workspaces, activeWorkspace } from '$lib/stores/workspaces.js'
  import { canActive } from '$lib/stores/capabilities.js'

  let loaded = false
  let error: string | null = null

  $: hasWorkspaces = $canActive('workspaces')
  $: if (hasWorkspaces && !loaded) { loaded = true; void loadWorkspaces() }

  async function loadWorkspaces() {
    try {
      workspaces.set(await api.workspaces())
    } catch (e) {
      error = (e as Error).message
    }
  }

  function select(dir: string | null) {
    activeWorkspace.set(dir)
  }
</script>

<div class="chips">
  <button
    class="chip"
    class:active={$activeWorkspace === null}
    type="button"
    on:click={() => select(null)}
  >
    all
  </button>
  {#each $workspaces as w (w.directory)}
    <button
      class="chip"
      class:active={$activeWorkspace === w.directory}
      type="button"
      title={w.directory}
      on:click={() => select(w.directory)}
    >
      {w.name}
    </button>
  {/each}
</div>
{#if error}<div class="err">{error}</div>{/if}

<style>
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 14px 10px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    padding: 4px 9px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-2);
    background: transparent;
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: 10.5px;
    cursor: pointer;
    transition: background .12s ease, border-color .12s ease, color .12s ease;
  }
  .chip:hover:not(.active) {
    background: var(--bg-elev);
    color: var(--text);
    border-color: var(--border);
  }
  .chip.active {
    background: var(--accent-2);
    color: var(--accent);
    border-color: var(--accent-line);
  }
  .err {
    padding: 0 14px 8px;
    font-size: 11px;
    color: var(--err);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
