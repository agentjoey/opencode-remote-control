<!-- src/lib/components/WorkspaceSwitcher.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation'
  import { api } from '$lib/api/client.js'
  import { workspaces, activeWorkspace } from '$lib/stores/workspaces.js'
  import { sessionList } from '$lib/stores/sessions.js'
  import { canActive, backends } from '$lib/stores/capabilities.js'

  let creating = false
  let error: string | null = null
  let dirInput = '' // freeform: the directory a new ACP session runs in
  let loadedKey = ''
  let open = false // freeform directory dropdown open?

  // Close the freeform dropdown on any click outside this combobox.
  function clickOutside(node: HTMLElement) {
    const handler = (e: MouseEvent) => { if (open && !node.contains(e.target as Node)) open = false }
    document.addEventListener('click', handler, true)
    return { destroy() { document.removeEventListener('click', handler, true) } }
  }

  $: hasWorkspaces = $canActive('workspaces')
  // ACP agents take an arbitrary, user-entered directory; opencode picks from
  // enumerated projects.
  $: freeform = $canActive('freeformWorkspace')
  // (Re)load workspaces once capabilities are known AND whenever the active
  // backend changes — so switching to kimi *after* mount still seeds the
  // directory and enables the "+". Keyed → loads once per (backend, hasWorkspaces).
  $: key = `${$backends?.activeId ?? 'single'}:${hasWorkspaces ? 1 : 0}`
  $: if (hasWorkspaces && key !== loadedKey) { loadedKey = key; void loadWorkspaces() }

  async function loadWorkspaces() {
    try {
      activeWorkspace.set(null) // clear any directory filter carried over from another backend
      workspaces.set(await api.workspaces())
      // Seed the freeform input with a known directory (or host default) so a new
      // ACP session is one click away — the "+" is disabled while the input is empty.
      if (freeform) dirInput = $workspaces[0]?.directory ?? dirInput
    } catch (e) {
      error = (e as Error).message
    }
  }

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
  // Default to the selected workspace, else the most-recent one — so "+" works
  // without forcing an explicit pick.
  const newInWorkspace = () => create(($activeWorkspace as string) || $workspaces[0]?.directory || '')
  // "+" targets the typed dir, else the most-recent (so it works under "All", like opencode).
  const newInDir = () => create(dirInput.trim() || $workspaces[0]?.directory || '')
  // Freeform dropdown: picking a dir both filters the session list AND targets the
  // new session there (mirrors opencode's workspace <select>). "All" clears the
  // filter AND the input, so the field reflects the current selection (not a stale dir).
  function pickDir(dir: string) { activeWorkspace.set(dir); dirInput = dir; open = false }
  function pickAll() { activeWorkspace.set(null); dirInput = ''; open = false }
</script>

<div class="ws">
  <div class="row">
    {#if freeform}
      <!-- Combobox: type a directory OR pick from every folder kimi has sessions
           in. A native <datalist> filters by the typed text (collapsing to the
           seeded path), so we roll our own dropdown that always lists them all. -->
      <div class="combo" use:clickOutside>
        <input
          class="select"
          bind:value={dirInput}
          placeholder="Working directory…"
          title="Directory the new session runs in"
          on:focus={() => (open = true)}
          on:keydown={(e) => { if (e.key === 'Enter') { open = false; newInDir() } else if (e.key === 'Escape') open = false }}
        />
        <button class="caret" type="button" aria-label="Choose a directory" on:click={() => (open = !open)}>▾</button>
        {#if open}
          <div class="menu">
            <button class="opt" type="button" on:click={pickAll}>
              <span class="ck">{$activeWorkspace ? '' : '✓'}</span>
              <span class="od">All directories</span>
            </button>
            {#each $workspaces as w (w.directory)}
              <button class="opt" type="button" title={w.directory} on:click={() => pickDir(w.directory)}>
                <span class="ck">{$activeWorkspace === w.directory ? '✓' : ''}</span>
                <span class="od">{w.name}</span>
                {#if w.sessionCount}<span class="oc">{w.sessionCount}</span>{/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>
      <button class="new" title="New session in this directory" disabled={creating || !(dirInput.trim() || $workspaces[0]?.directory)} on:click={newInDir}>
        {creating ? '…' : '➕'}
      </button>
    {:else if hasWorkspaces}
      <select class="select" value={$activeWorkspace ?? ''} on:change={onSelect} title="Workspace">
        <option value="">All workspaces</option>
        {#each $workspaces as w (w.directory)}
          <option value={w.directory}>{w.name} ({w.sessionCount})</option>
        {/each}
      </select>
      <button class="new" title="New session in workspace" disabled={creating || !($activeWorkspace || $workspaces[0]?.directory)} on:click={newInWorkspace}>
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
  /* freeform directory combobox (always lists every known dir, unlike <datalist>) */
  .combo { position: relative; flex: 1; min-width: 0; display: flex; align-items: center; }
  .combo .select { flex: 1; padding-right: 22px; cursor: text; }
  .caret {
    position: absolute; right: 4px; top: 50%; transform: translateY(-50%);
    background: transparent; border: none; color: var(--text-3);
    font-size: 10px; cursor: pointer; padding: 4px; line-height: 1;
  }
  .caret:hover { color: var(--text); }
  .menu {
    position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 50;
    background: var(--bg-panel); border: 1px solid var(--border);
    border-radius: var(--radius-sm); max-height: 240px; overflow-y: auto;
    box-shadow: 0 8px 24px rgba(0,0,0,.45); padding: 4px;
  }
  .opt {
    display: flex; align-items: center; gap: 8px; width: 100%;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--text-2); font-size: 11.5px; text-align: left;
    padding: 6px 8px; cursor: pointer;
  }
  .opt:hover { background: var(--bg-elev); color: var(--text); }
  .opt .ck { flex-shrink: 0; width: 12px; color: var(--accent); font-size: 10px; text-align: center; }
  .opt .od { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .opt .oc { flex-shrink: 0; color: var(--text-3); font-variant-numeric: tabular-nums; }
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
