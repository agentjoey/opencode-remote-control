<!-- src/lib/components/WorkspaceSwitcher.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { api } from '$lib/api/client.js'
  import { workspaces, activeWorkspace } from '$lib/stores/workspaces.js'
  import { sessionList } from '$lib/stores/sessions.js'

  let creating = false
  let error: string | null = null

  onMount(async () => {
    try {
      workspaces.set(await api.workspaces())
    } catch (e) {
      error = (e as Error).message
    }
  })

  function onSelect(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value
    activeWorkspace.set(value === '' ? null : value)
  }

  async function newSession() {
    if (creating || !$activeWorkspace) return
    creating = true
    error = null
    try {
      const res = await api.createSession({ directory: $activeWorkspace })
      sessionList.set(await api.sessions())
      goto(`/${res.id}/`)
    } catch (e) {
      error = (e as Error).message
    } finally {
      creating = false
    }
  }
</script>

<div class="ws">
  <div class="row">
    <select class="select" value={$activeWorkspace ?? ''} on:change={onSelect} title="Workspace">
      <option value="">All workspaces</option>
      {#each $workspaces as w (w.directory)}
        <option value={w.directory}>{w.name} ({w.sessionCount})</option>
      {/each}
    </select>
    <button
      class="new"
      title="New session in workspace"
      disabled={!$activeWorkspace || creating}
      on:click={newSession}
    >
      {creating ? '…' : '➕'}
    </button>
  </div>
  {#if error}<div class="err">{error}</div>{/if}
</div>

<style>
  .ws { padding: 8px 12px 4px; }
  .row { display: flex; align-items: center; gap: 6px; }
  .select {
    flex: 1;
    min-width: 0;
    background: var(--bg-elev);
    color: var(--text-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 5px 8px;
    font-size: 12px;
    cursor: pointer;
    transition: border-color .12s, color .12s;
  }
  .select:hover { border-color: var(--accent); color: var(--text); }
  .new {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    flex-shrink: 0;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-3);
    font-size: 13px;
    cursor: pointer;
    transition: border-color .12s, color .12s, opacity .12s;
  }
  .new:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .new:disabled { opacity: .4; cursor: default; }
  .err {
    margin-top: 5px;
    font-size: 11px;
    color: var(--err);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
