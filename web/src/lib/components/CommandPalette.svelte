<!-- src/lib/components/CommandPalette.svelte -->
<script lang="ts">
  import { tick, createEventDispatcher } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { sessionList } from '$lib/stores/sessions.js'
  import { filterSessions } from '$lib/nav/filterSessions.js'
  import { api } from '$lib/api/client.js'
  import { can, currentBackendId, backendName, ACCENTS, agentAccent, setAgentAccent } from '$lib/stores/capabilities.js'

  export let open = false

  const dispatch = createEventDispatcher<{ close: void }>()

  let query = ''
  let active = 0
  let cmdError = ''
  let running = ''
  type SessionRow = ReturnType<typeof filterSessions>[number]
  type BackendCommand = { name: string; description: string }

  let backendCommands: BackendCommand[] = []
  let loadedForBackend: string | null = null

  $: activeSessionId = $page.params.sessionId as string | undefined
  $: filteredSessions = filterSessions($sessionList, query)
  $: filteredBackend = backendCommands.filter((cmd) => match(cmd.name, cmd.description, query))
  $: filteredStatic = staticCommands.filter((cmd) => match(cmd.name, cmd.description, query))

  $: if (open && $currentBackendId && $currentBackendId !== loadedForBackend) {
    loadedForBackend = $currentBackendId
    if ($can('commands')) {
      api.commands($currentBackendId)
        .then((list) => { backendCommands = list })
        .catch(() => { loadedForBackend = null })
    } else {
      backendCommands = []
    }
  }

  $: flatItems = buildItems(filteredSessions, filteredBackend, filteredStatic, activeSessionId)
  $: selectableCount = flatItems.filter((i) => i.selectableIndex != null).length
  $: active = selectableCount ? Math.max(0, Math.min(active, selectableCount - 1)) : -1

  $: query, active = 0

  function match(name: string, description: string, q: string) {
    const needle = q.trim().toLowerCase()
    if (!needle) return true
    return name.toLowerCase().includes(needle) || description.toLowerCase().includes(needle)
  }

  const staticCommands = [
    { name: 'cycle-accent', description: 'Cycle accent color' }
  ]

  type FlatItem = {
    type: 'group' | 'session' | 'command'
    label?: string
    icon?: string
    session?: SessionRow
    command?: { name: string; description: string; kind?: 'backend' }
    disabled?: boolean
    selectableIndex?: number
  }

  function buildItems(
    sessions: SessionRow[],
    backendCmds: BackendCommand[],
    staticCmds: BackendCommand[],
    sessionId: string | undefined
  ): FlatItem[] {
    const out: FlatItem[] = []
    let idx = 0

    if (sessions.length) {
      out.push({ type: 'group', label: 'Sessions', icon: '#' })
      for (const s of sessions) {
        out.push({ type: 'session', session: s, selectableIndex: idx++ })
      }
    }

    const commands: NonNullable<FlatItem['command']>[] = [
      ...backendCmds.map((c) => ({ ...c, kind: 'backend' as const })),
      ...staticCmds.map((c) => ({ ...c }))
    ]

    if (commands.length) {
      out.push({ type: 'group', label: 'Commands', icon: '/' })
      for (const c of commands) {
        const disabled = c.kind === 'backend' && !sessionId
        out.push({ type: 'command', command: c, disabled, selectableIndex: disabled ? undefined : idx++ })
      }
    }

    return out
  }

  export function close() {
    dispatch('close')
    query = ''
    cmdError = ''
  }

  function choose(id: string) {
    goto(`/${id}/`)
    close()
  }

  function cycleAccent() {
    const id = $currentBackendId ?? 'opencode'
    const current = agentAccent(id)
    const next = ACCENTS[(ACCENTS.indexOf(current) + 1) % ACCENTS.length]
    setAgentAccent(id, next)
  }

  async function runCommand(name: string) {
    if (name === 'cycle-accent') {
      cycleAccent()
      close()
      return
    }
    if (!activeSessionId || running) return
    running = name
    cmdError = ''
    try {
      await api.runCommand({ sessionId: activeSessionId, command: name })
      close()
    } catch (err) {
      cmdError = `/${name} failed: ${(err as Error).message}`
    } finally {
      running = ''
    }
  }

  function activateItem(item: FlatItem) {
    if (item.type === 'session' && item.session) choose(item.session.id)
    else if (item.type === 'command' && !item.disabled && item.command) runCommand(item.command.name)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { close(); return }
    if (selectableCount === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      active = Math.min(active + 1, selectableCount - 1)
      scrollActive()
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      active = Math.max(active - 1, 0)
      scrollActive()
      return
    }
    if (e.key === 'Enter') {
      const item = flatItems.find((i) => i.selectableIndex === active)
      if (item) { e.preventDefault(); activateItem(item) }
    }
  }

  async function scrollActive() {
    await tick()
    const el = document.querySelector('.palette .row.active') as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }

  function commandHint(item?: FlatItem['command'], disabled?: boolean): string {
    if (disabled) return 'Open a session first'
    return item?.description ?? ''
  }
</script>

{#if open}
  <div class="overlay">
    <button class="backdrop" aria-label="Close" on:click={close}></button>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Search sessions and commands" tabindex="-1">
      <div class="header">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="q"
          autofocus
          placeholder="Jump to a session, or run a command…"
          bind:value={query}
          on:keydown={onKey}
        />
        <kbd class="keycap mono" aria-label="Press Escape to close">esc</kbd>
      </div>
      <div class="results">
        {#if flatItems.length === 0}
          <div class="empty">No matches</div>
        {:else}
          {#each flatItems as item (item.session?.id ?? item.command?.name ?? item.label ?? '')}
            {#if item.type === 'group'}
              <div class="group">
                <span class="group-icon" aria-hidden="true">{item.icon}</span>
                <span class="group-label mono">{item.label}</span>
              </div>
            {:else if item.type === 'session'}
              <button
                class="row"
                class:active={item.selectableIndex === active}
                on:click={() => { if (item.session) choose(item.session.id) }}
                on:mouseenter={() => { if (item.selectableIndex != null) active = item.selectableIndex }}
              >
                <span class="tile" aria-hidden="true">#</span>
                <span class="label">{item.session?.title ?? item.session?.id.slice(-8) ?? ''}</span>
                <span class="hint mono">{item.session?.agent ?? ''}</span>
              </button>
            {:else if item.type === 'command'}
              <button
                class="row"
                class:active={item.selectableIndex === active}
                class:disabled={item.disabled}
                disabled={item.disabled || running === item.command?.name}
                on:click={() => { if (item.command) runCommand(item.command.name) }}
                on:mouseenter={() => { if (item.selectableIndex != null) active = item.selectableIndex }}
              >
                <span class="tile" aria-hidden="true">/</span>
                <span class="label">{item.command?.name ?? ''}</span>
                <span class="hint mono">
                  {running === item.command?.name ? 'running…' : commandHint(item.command, item.disabled)}
                </span>
              </button>
            {/if}
          {/each}
        {/if}
        {#if cmdError}<div class="error">{cmdError}</div>{/if}
      </div>
    </div>
  </div>
{/if}


<style>
  .overlay {
    position: fixed;
    inset: 0;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding-top: 84px;
    z-index: 200;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: rgba(8, 7, 6, .62);
    border: none;
    padding: 0;
    margin: 0;
    cursor: default;
  }
  .palette {
    position: relative;
    z-index: 1;
    width: min(560px, 92vw);
    max-height: calc(100vh - 120px);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    box-shadow: var(--shadow-palette);
    display: flex;
    flex-direction: column;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .search-icon {
    font-size: 18px;
    color: var(--text-3);
    line-height: 1;
    flex-shrink: 0;
  }
  .q {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 15px;
    outline: none;
    padding: 0;
  }
  .q::placeholder { color: var(--text-4); }
  .keycap {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-3);
    text-transform: uppercase;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 3px 6px;
  }
  .results {
    overflow-y: auto;
    padding: 8px;
  }
  .group {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px 4px;
  }
  .group-icon {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: var(--accent-2);
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 600;
  }
  .group-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--text-3);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    background: transparent;
    border: none;
    color: var(--text);
    padding: 7px 10px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    text-align: left;
    transition: background .12s ease;
  }
  .row.active, .row:hover:not(.disabled) { background: var(--accent-2); }
  .row.disabled { opacity: .5; cursor: default; }
  .row:disabled { opacity: .5; cursor: default; }
  .tile {
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    border-radius: 6px;
    background: var(--bg-panel);
    border: 1px solid var(--border-2);
    color: var(--text-2);
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
  }
  .label {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 13.5px;
    color: var(--text);
    text-transform: none;
    letter-spacing: normal;
  }
  .hint {
    flex-shrink: 0;
    max-width: 45%;
    font-size: 11px;
    color: var(--text-4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: right;
  }
  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-3);
    font-size: 13.5px;
  }
  .error {
    padding: 10px;
    color: var(--err);
    font-size: 12px;
  }
</style>
