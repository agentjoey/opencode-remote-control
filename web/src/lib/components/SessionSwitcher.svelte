<!-- src/lib/components/SessionSwitcher.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation'
  import { sessionList } from '$lib/stores/sessions.js'
  import { backends, agentAccent, setActiveBackend, type CapabilitiesSnapshot } from '$lib/stores/capabilities.js'
  import { api } from '$lib/api/client.js'
  import { workspaces, activeWorkspace } from '$lib/stores/workspaces.js'

  export let activeId: string | undefined = undefined

  let open = false
  let creating = false

  const ACCENT_HEX: Record<string, string> = {
    emerald: '#3fb27f',
    azure: '#4a9eed',
    amber: '#e0a341',
    violet: '#a98cf0',
  }
  const ACCENT_BG: Record<string, string> = {
    emerald: '#243029',
    azure: '#1c2733',
    amber: '#2e2716',
    violet: '#221f33',
  }
  const ACCENT_LINE: Record<string, string> = {
    emerald: '#2e6e52',
    azure: '#2f5f8c',
    amber: '#8c6e2f',
    violet: '#5e4f8c',
  }

  $: activeBackendId = $backends?.activeId ?? $backends?.backends[0]?.id ?? 'opencode'
  $: activeAgent = $backends?.backends.find((b) => b.id === activeBackendId)
  $: theme = agentAccent(activeBackendId)
  $: sessions = $sessionList
    .filter((s) => s.backendId === activeBackendId || (!s.backendId && activeBackendId === 'opencode'))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  $: activeSession = $sessionList.find((s) => s.id === activeId)
  $: title = activeSession?.title || 'Untitled session'

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

  function toggle() {
    open = !open
  }

  function select(id: string) {
    open = false
    goto(`/${id}/`)
  }

  async function createSession() {
    if (creating) return
    const directory = $activeWorkspace || $workspaces[0]?.directory || ''
    creating = true
    try {
      await setActiveBackend(activeBackendId)
      const res = await api.createSession({ directory })
      sessionList.set(await api.sessions())
      workspaces.set(await api.workspaces())
      open = false
      goto(`/${res.id}/`)
    } catch (e) {
      alert(`创建会话失败：${(e as Error).message}`)
    } finally {
      creating = false
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false
  }

  function formatTime(ts: number): string {
    const diff = Date.now() - ts
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'now'
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}d`
  }

  function shortId(id: string): string {
    const bare = id.includes('_') ? id.slice(id.indexOf('_') + 1) : id
    return bare.slice(-8)
  }
</script>

<svelte:window on:keydown={onKey} />

<div class="switcher">
  <button
    class="trigger"
    on:click={toggle}
    aria-haspopup="true"
    aria-expanded={open}
    title="Switch session"
  >
    <span
      class="glyph-tile"
      style="background:{ACCENT_BG[theme]}; color:{ACCENT_HEX[theme]}; border-color:{ACCENT_LINE[theme]}"
    >
      {glyph(activeAgent)}
    </span>
    <span class="status-dot {statusClass(activeAgent?.status)}"></span>
    <span class="title">{title}</span>
    <span class="caret" aria-hidden="true">▾</span>
  </button>

  {#if open}
    <div class="popover" role="dialog" aria-label="Session switcher">
      <div class="list">
        {#each sessions as s (s.id)}
          <button class="row" class:active={s.id === activeId} on:click={() => select(s.id)}>
            <span class="dot {s.id === activeId ? 'active' : ''}"></span>
            <span class="info">
              <span class="row-title">{s.title || 'Untitled session'}</span>
              <span class="row-meta mono">{shortId(s.id)} · {formatTime(s.lastActiveAt)}</span>
            </span>
            {#if s.id === activeId}<span class="check">✓</span>{/if}
          </button>
        {:else}
          <div class="empty">No sessions on {activeAgent?.name ?? activeAgent?.id ?? 'this agent'}.</div>
        {/each}
      </div>
      <div class="footer">
        <button class="new-session mono" on:click={createSession} disabled={creating}>
          + New session on {activeAgent?.name ?? activeAgent?.id ?? 'agent'}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .switcher {
    position: relative;
    display: inline-flex;
    min-width: 0;
  }
  .trigger {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    padding: 5px 9px 5px 5px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--text-2);
    cursor: pointer;
    transition: border-color .12s ease, background .12s ease;
  }
  .trigger:hover { border-color: var(--accent); background: var(--bg-elev2); }
  .glyph-tile {
    width: 22px;
    height: 22px;
    display: inline-grid;
    place-items: center;
    border-radius: 6px;
    border: 1px solid transparent;
    font-family: var(--font-mono);
    font-size: 10px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .status-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .status-dot.online { background: var(--ok); border-color: var(--ok); }
  .status-dot.connecting { background: var(--warn); border-color: var(--warn); animation: ocrc-pulse 1.2s ease-in-out infinite; }
  .status-dot.offline { background: transparent; border: 1.5px solid var(--text-4); }
  .title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caret {
    font-size: 9px;
    color: var(--text-3);
    flex-shrink: 0;
  }

  .popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    width: min(280px, calc(100vw - 32px));
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 18px 50px rgba(0,0,0,.55);
    z-index: 50;
    overflow: hidden;
    animation: ocrc-pop .14s ease;
  }
  @keyframes ocrc-pop {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .list {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: background .12s ease;
  }
  .row:hover, .row.active { background: var(--accent-2); }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    flex-shrink: 0;
    box-sizing: border-box;
    background: transparent;
    border-color: var(--text-4);
  }
  .dot.active { background: var(--accent); border-color: var(--accent); }
  .info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .row-title {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-meta {
    font-size: 10.5px;
    color: var(--text-3);
  }
  .check {
    font-size: 13px;
    color: var(--accent);
    flex-shrink: 0;
  }
  .empty {
    padding: 14px 10px;
    color: var(--text-3);
    font-size: 12px;
  }

  .footer {
    border-top: 1px solid var(--border);
    padding: 6px;
  }
  .new-session {
    display: flex;
    align-items: center;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-2);
    font-size: 12px;
    cursor: pointer;
    transition: color .12s ease, border-color .12s ease, background .12s ease;
  }
  .new-session:hover { color: var(--accent); border-color: var(--accent-line); background: var(--accent-2); }
  .new-session:disabled { opacity: .5; cursor: default; }
</style>
