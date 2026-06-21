<script lang="ts">
  import { goto } from '$app/navigation'
  import { api } from '$lib/api/client.js'
  import { backends, setActiveBackend, agentAccent, ACCENTS, ACCENT_HEX, ACCENT_BG, ACCENT_LINE, type Accent, type CapabilitiesSnapshot } from '$lib/stores/capabilities.js'
  import { workspaces } from '$lib/stores/workspaces.js'
  import { sessionList } from '$lib/stores/sessions.js'
  import { newSessionOpen } from '$lib/stores/ui.js'


  $: agents = $backends?.backends ?? []
  $: defaultAgentId = $backends?.activeId ?? agents[0]?.id ?? 'opencode'
  let selectedAgentId = ''
  $: selectedAgentId = selectedAgentId || defaultAgentId

  let directory = ''
  let branch = ''
  let creating = false
  let error: string | null = null
  let showRecents = false

  function glyphFrom(text: string): string {
    const words = text.split(/[\s\-_:./]+/).filter(Boolean)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return text.slice(0, 2).toUpperCase()
  }
  function glyph(agent?: CapabilitiesSnapshot): string {
    return glyphFrom(agent?.name || agent?.id || 'OC')
  }

  function statusClass(status?: string): string {
    if (status === 'online' || status === 'connected') return 'online'
    if (status === 'connecting' || status === 'reconnecting') return 'connecting'
    if (status === 'offline') return 'offline'
    return 'online'
  }

  function close() {
    newSessionOpen.set(false)
    error = null
  }

  function pickRecent(dir: string) {
    directory = dir
    showRecents = false
  }

  async function browse() {
    try {
      if ('showDirectoryPicker' in window) {
        const handle = await (window as any).showDirectoryPicker()
        directory = handle.name
      } else {
        const input = document.getElementById('new-session-browse') as HTMLInputElement | null
        input?.click()
      }
    } catch {
      // user cancelled
    }
  }

  function onBrowseFiles(e: Event) {
    const files = (e.target as HTMLInputElement).files
    if (files && files.length > 0) {
      // webkitdirectory gives relative paths; derive the root directory name.
      const path = files[0].webkitRelativePath || files[0].name
      const parts = path.split('/')
      directory = parts.length > 1 ? parts[0] : path
    }
  }

  async function submit() {
    const dir = directory.trim()
    if (!dir) {
      error = 'Working directory is required'
      return
    }
    if (creating) return
    creating = true
    error = null
    try {
      await setActiveBackend(selectedAgentId)
      // Branch is collected in the UI per the redesign; wiring it to the backend
      // is out of scope for this frontend-only chunk.
      const res = await api.createSession({ directory: dir })
      sessionList.set(await api.sessions())
      workspaces.set(await api.workspaces())
      close()
      goto(`/${res.id}/`)
    } catch (e) {
      error = (e as Error).message
    } finally {
      creating = false
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }
</script>

<svelte:window on:keydown={onKey} />

{#if $newSessionOpen}
  <div class="overlay">
    <button class="backdrop" aria-label="Close" on:click={close}></button>
    <div class="modal" role="dialog" aria-modal="true" aria-label="Create new session">
      <div class="header">
        <span class="title">New session</span>
        <button class="close" aria-label="Close" on:click={close}>✕</button>
      </div>

      <div class="body">
        {#if agents.length === 0}
          <div class="empty">Loading agents…</div>
        {:else}
          <div class="field">
            <span class="label">Agent</span>
            <div class="agent-chips" role="radiogroup" aria-label="Select agent">
              {#each agents as a (a.id)}
                {@const theme = agentAccent(a.id)}
                {@const selected = a.id === selectedAgentId}
                <button
                  class="agent-chip"
                  class:selected
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  on:click={() => { selectedAgentId = a.id }}
                >
                  <span
                    class="chip-tile"
                    style="background:{ACCENT_BG[theme]}; color:{ACCENT_HEX[theme]}; border-color:{ACCENT_LINE[theme]}"
                  >
                    {glyph(a)}
                  </span>
                  <span class="chip-name">{a.name ?? a.id}</span>
                  <span class="chip-status {statusClass(a.status)}"></span>
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="field">
          <label class="label" for="new-session-dir">Working directory</label>
          <div class="dir-input">
            <span class="host-prefix mono">host:</span>
            <input
              id="new-session-dir"
              class="path mono"
              type="text"
              placeholder="/path/to/project"
              bind:value={directory}
              on:focus={() => { showRecents = true }}
            />
            <button class="browse" type="button" on:click={browse} title="Browse directory">Browse</button>
            <input id="new-session-browse" type="file" webkitdirectory style="display:none" on:change={onBrowseFiles} />
          </div>
          {#if $workspaces.length > 0}
            <div class="recents" class:open={showRecents}>
              <span class="recents-label mono">recent</span>
              <div class="recents-list">
                {#each $workspaces as w (w.directory)}
                  <button class="recent" type="button" on:click={() => pickRecent(w.directory)} title={w.directory}>
                    <span class="recent-name">{w.name}</span>
                    <span class="recent-dir mono">{w.directory}</span>
                  </button>
                {/each}
              </div>
            </div>
          {/if}
        </div>

        <div class="field">
          <label class="label" for="new-session-branch">Branch <span class="optional">(optional)</span></label>
          <input
            id="new-session-branch"
            class="branch mono"
            type="text"
            placeholder="main"
            bind:value={branch}
          />
        </div>

        {#if error}<div class="error">{error}</div>{/if}
      </div>

      <div class="footer">
        <button class="btn secondary" type="button" on:click={close} disabled={creating}>Cancel</button>
        <button class="btn primary" type="button" on:click={submit} disabled={creating || !directory.trim()}>
          {creating ? 'Creating…' : 'Create'}
        </button>
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
    z-index: 300;
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
  .modal {
    position: relative;
    z-index: 1;
    width: min(460px, 92vw);
    max-height: calc(100vh - 120px);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 24px 70px rgba(0,0,0,.6);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: ocrc-pop .14s ease;
  }
  @keyframes ocrc-pop {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .title {
    font-size: 15px;
    font-weight: 600;
    color: var(--text);
  }
  .close {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-3);
    cursor: pointer;
    font-size: 14px;
    transition: color .12s ease, background .12s ease, border-color .12s ease;
  }
  .close:hover { color: var(--text); background: var(--bg-elev2); border-color: var(--border); }

  .body {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 18px;
    overflow-y: auto;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .label {
    font-size: 10.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .12em;
    color: var(--text-3);
  }
  .optional {
    font-weight: 400;
    color: var(--text-4);
    text-transform: none;
    letter-spacing: normal;
  }

  .agent-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .agent-chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 10px 5px 5px;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text-2);
    cursor: pointer;
    transition: border-color .12s ease, background .12s ease;
  }
  .agent-chip:hover { border-color: var(--accent); background: var(--bg-elev2); }
  .agent-chip.selected {
    background: var(--accent-2);
    border-color: var(--accent-line);
    color: var(--text);
  }
  .chip-tile {
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
    border-radius: 6px;
    border: 1px solid transparent;
    font-family: var(--font-mono);
    font-size: 9.5px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .chip-name {
    font-size: 12px;
    font-weight: 600;
  }
  .chip-status {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .chip-status.online { background: var(--accent); border-color: var(--accent); }
  .chip-status.connecting { background: var(--warn); border-color: var(--warn); animation: ocrc-pulse 1.2s ease-in-out infinite; }
  .chip-status.offline { background: transparent; border: 1.5px solid var(--text-4); }

  .dir-input {
    display: flex;
    align-items: center;
    gap: 0;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    transition: border-color .15s ease;
  }
  .dir-input:focus-within { border-color: var(--accent); }
  .host-prefix {
    padding: 8px 0 8px 10px;
    font-size: 12.5px;
    color: var(--text-3);
    flex-shrink: 0;
  }
  .path {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 12.5px;
    padding: 8px 10px;
    outline: none;
  }
  .path::placeholder { color: var(--text-4); }
  .browse {
    border: none;
    border-left: 1px solid var(--border);
    background: var(--bg-panel);
    color: var(--text-3);
    font-size: 11px;
    font-weight: 600;
    padding: 0 12px;
    cursor: pointer;
    transition: color .12s ease, background .12s ease;
    flex-shrink: 0;
  }
  .browse:hover { color: var(--text); background: var(--bg-elev2); }

  .recents {
    display: none;
    flex-direction: column;
    gap: 6px;
  }
  .recents.open { display: flex; }
  .recents-label {
    font-size: 10px;
    color: var(--text-4);
    text-transform: uppercase;
    letter-spacing: .1em;
  }
  .recents-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 160px;
    overflow-y: auto;
    padding: 4px;
    background: var(--bg-panel);
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
  }
  .recent {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: background .12s ease;
  }
  .recent:hover { background: var(--bg-elev); }
  .recent-name {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  .recent-dir {
    font-size: 10.5px;
    color: var(--text-4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    width: 100%;
  }

  .branch {
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text);
    font-size: 12.5px;
    padding: 8px 10px;
    outline: none;
    transition: border-color .15s ease;
  }
  .branch:focus { border-color: var(--accent); }
  .branch::placeholder { color: var(--text-4); }

  .error {
    padding: 10px 12px;
    background: rgba(224, 121, 107, .12);
    border: 1px solid rgba(224, 121, 107, .35);
    border-radius: var(--radius-sm);
    color: var(--err);
    font-size: 12px;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    padding: 14px 16px;
    border-top: 1px solid var(--border);
    flex-shrink: 0;
  }
  .btn {
    padding: 7px 14px;
    border-radius: var(--radius-sm);
    font-size: 13px;
    font-weight: 650;
    cursor: pointer;
    transition: opacity .12s ease, transform .12s ease;
    border: none;
  }
  .btn:disabled { opacity: .5; cursor: default; }
  .secondary {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-2);
  }
  .secondary:hover:not(:disabled) { background: var(--bg-elev2); color: var(--text); }
  .primary {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .primary:hover:not(:disabled) { opacity: .9; }

  .empty {
    padding: 24px;
    text-align: center;
    color: var(--text-3);
    font-size: 13.5px;
  }

  @media (max-width: 820px) {
    .overlay {
      align-items: flex-end;
      padding: 0 0 env(safe-area-inset-bottom, 0);
    }
    .modal {
      width: 100%;
      max-height: 86vh;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      animation: sheetin .22s ease;
    }
    @keyframes sheetin {
      from { opacity: 0; transform: translateY(40px); }
      to { opacity: 1; transform: translateY(0); }
    }
  }
</style>
