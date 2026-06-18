<!-- src/lib/components/WorkspaceSwitcher.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { api } from '$lib/api/client.js'
  import { workspaces, activeWorkspace } from '$lib/stores/workspaces.js'
  import { sessionList } from '$lib/stores/sessions.js'
  import { canActive } from '$lib/stores/capabilities.js'

  let creating = false
  let error: string | null = null
  let dirInput = '' // freeform: the directory a new ACP session runs in

  $: hasWorkspaces = $canActive('workspaces')
  // ACP agents take an arbitrary, user-entered directory; opencode picks from
  // enumerated projects.
  $: freeform = $canActive('freeformWorkspace')

  onMount(async () => {
    if (!hasWorkspaces) return
    try {
      workspaces.set(await api.workspaces())
      // Seed the freeform input with the most-recent known directory (or the
      // host default), so a first session is one click away.
      if (freeform && !dirInput) dirInput = $workspaces[0]?.directory ?? ''
    } catch (e) {
      error = (e as Error).message
    }
  })

  function onSelect(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value
    activeWorkspace.set(value === '' ? null : value)
  }

  async function create(directory: string) {
    if (creating || !directory.trim()) return
    creating = true
    error = null
    try {
      const res = await api.createSession({ directory: directory.trim() })
      sessionList.set(await api.sessions())
      workspaces.set(await api.workspaces())
      goto(`/${res.id}/`)
    } catch (e) {
      error = (e as Error).message
    } finally {
      creating = false
    }
  }
  const newInWorkspace = () => create(($activeWorkspace as string) ?? '')
  const newInDir = () => create(dirInput)
</script>

<div class="ws">
  <div class="row">
    {#if freeform}
      <input
        class="select"
        list="ws-dirs"
        bind:value={dirInput}
        placeholder="Working directory…"
        title="Directory the new session runs in"
        on:keydown={(e) => { if (e.key === 'Enter') newInDir() }}
      />
      <datalist id="ws-dirs">
        {#each $workspaces as w (w.directory)}<option value={w.directory}>{w.name}{w.sessionCount ? ` (${w.sessionCount})` : ''}</option>{/each}
      </datalist>
      <button class="new" title="New session in this directory" disabled={!dirInput.trim() || creating} on:click={newInDir}>
        {creating ? '…' : '➕'}
      </button>
    {:else if hasWorkspaces}
      <select class="select" value={$activeWorkspace ?? ''} on:change={onSelect} title="Workspace">
        <option value="">All workspaces</option>
        {#each $workspaces as w (w.directory)}
          <option value={w.directory}>{w.name} ({w.sessionCount})</option>
        {/each}
      </select>
      <button class="new" title="New session in workspace" disabled={!$activeWorkspace || creating} on:click={newInWorkspace}>
        {creating ? '…' : '➕'}
      </button>
    {:else}
      <button class="new wide" title="New session" disabled={creating} on:click={() => create('')}>
        {creating ? '…' : '➕ New session'}
      </button>
    {/if}
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
  .new.wide { width: 100%; gap: 6px; font-size: 12px; color: var(--text-2); }
  .err {
    margin-top: 5px;
    font-size: 11px;
    color: var(--err);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
