<!-- src/lib/components/AgentPanel.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation'
  import SessionList from './SessionList.svelte'
  import {
    backends,
    setActiveBackend,
    ACCENTS,
    agentAccent,
    setAgentAccent,
    defaultAccentForAgent,
    type Accent,
    type CapabilitiesSnapshot,
  } from '$lib/stores/capabilities.js'
  import { sessionList } from '$lib/stores/sessions.js'
  import { connection } from '$lib/stores/connection.js'
  import { leftPanelOpen } from '$lib/stores/ui.js'

  export let activeId: string | undefined = undefined
  // Drawer mode (mobile): panel fills the off-canvas drawer.
  export let drawer = false

  let pickerOpen = false

  const ACCENT_HEX: Record<Accent, string> = {
    emerald: '#3fb27f',
    azure: '#4a9eed',
    amber: '#e0a341',
    violet: '#a98cf0',
  }
  const ACCENT_BG: Record<Accent, string> = {
    emerald: '#243029',
    azure: '#1c2733',
    amber: '#2e2716',
    violet: '#221f33',
  }
  const ACCENT_LINE: Record<Accent, string> = {
    emerald: '#2e6e52',
    azure: '#2f5f8c',
    amber: '#8c6e2f',
    violet: '#5e4f8c',
  }

  $: activeBackendId = $backends?.activeId ?? $backends?.backends[0]?.id ?? 'opencode'
  $: activeAgent = $backends?.backends.find((b) => b.id === activeBackendId)
  $: agents = $backends?.backends ?? []

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

  function sessionCount(id: string): number {
    return $sessionList.filter((s) => s.backendId === id || (!s.backendId && id === 'opencode')).length
  }

  async function selectAgent(id: string) {
    await setActiveBackend(id)
    pickerOpen = false
    const list = $sessionList
      .filter((s) => s.backendId === id || (!s.backendId && id === 'opencode'))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    if (list[0]) goto(`/${list[0].id}/`)
  }

  function togglePicker() {
    pickerOpen = !pickerOpen
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') pickerOpen = false
  }

  const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000
  function isOnline(lastActiveAt: number, conn: string): boolean {
    return conn === 'connected' && Date.now() - lastActiveAt < ACTIVE_WINDOW_MS
  }

  $: activeCount = $sessionList.filter(
    (s) =>
      (s.backendId === activeBackendId || (!s.backendId && activeBackendId === 'opencode')) &&
      isOnline(s.lastActiveAt, $connection),
  ).length
  $: pushedCount = $sessionList.filter(
    (s) =>
      (s.backendId === activeBackendId || (!s.backendId && activeBackendId === 'opencode')) &&
      (s.additions || s.deletions),
  ).length

  $: activeTheme = agentAccent(activeBackendId)
</script>

<svelte:window on:keydown={onKey} />

<div class="agent-panel" class:drawer>
  <div class="panel">
    <div class="header">
      <button class="agent-pill" on:click={togglePicker} aria-haspopup="true" aria-expanded={pickerOpen}>
        <span
          class="glyph-tile"
          style="background:{ACCENT_BG[activeTheme]}; color:{ACCENT_HEX[activeTheme]}; border-color:{ACCENT_LINE[activeTheme]}"
        >
          {glyph(activeAgent)}
        </span>
        <span class="status-dot {statusClass(activeAgent?.status)}"></span>
        <span class="name mono">{activeAgent?.name ?? activeAgent?.id ?? 'Agent'}</span>
        {#if activeAgent?.host}<span class="host mono">{activeAgent.host}</span>{/if}
        <span class="caret" aria-hidden="true">▾</span>
      </button>
      {#if !drawer}
        <button class="collapse" title="Collapse panel" aria-label="Collapse panel" on:click={() => leftPanelOpen.set(false)}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      {/if}

      {#if pickerOpen}
        <div class="picker" role="dialog" aria-label="Agent picker">
          <div class="picker-list">
            {#each agents as a (a.id)}
              {@const theme = agentAccent(a.id)}
              {@const selected = a.id === activeBackendId}
              <button class="agent-row" class:selected on:click={() => selectAgent(a.id)}>
                <span
                  class="row-tile"
                  style="background:{ACCENT_BG[theme]}; color:{ACCENT_HEX[theme]}; border-color:{ACCENT_LINE[theme]}"
                >
                  {glyph(a)}
                </span>
                <span class="row-info">
                  <span class="row-name mono">{a.name ?? a.id}</span>
                  <span class="row-host mono">{a.host ?? 'local'} · {sessionCount(a.id)} ses</span>
                </span>
                <span class="status-dot {statusClass(a.status)}"></span>
                {#if selected}<span class="check">✓</span>{/if}
              </button>
            {/each}
          </div>
          <div class="picker-footer">
            <div class="theme-row">
              <span class="theme-label mono">Theme · {activeAgent?.name ?? activeAgent?.id ?? 'Agent'}</span>
              <div class="swatches">
                {#each ACCENTS as accent}
                  <button
                    class="swatch"
                    class:active={activeTheme === accent}
                    aria-label="Set {accent} theme"
                    style="background:{ACCENT_HEX[accent]}"
                    on:click={() => setAgentAccent(activeBackendId, accent)}
                  ></button>
                {/each}
                <button
                  class="auto"
                  class:active={agentAccent(activeBackendId) === defaultAccentForAgent(activeBackendId)}
                  on:click={() => setAgentAccent(activeBackendId, null)}
                >auto</button>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
    <div class="list">
      <SessionList {activeId} agentId={activeBackendId} agentName={activeAgent?.name ?? activeAgent?.id} />
    </div>
    <div class="footer mono">
      <span>{activeCount} active</span>
      <span class="sep">·</span>
      <span>{pushedCount} pushed</span>
    </div>
  </div>
</div>

<style>
  .agent-panel {
    display: flex;
    height: 100%;
    background: var(--bg-panel);
    border-right: 1px solid var(--border-2);
    flex-shrink: 0;
  }
  .agent-panel.drawer { width: 100%; border-right: none; }
  .panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
  }
  .header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 12px 12px 10px;
    border-bottom: 1px solid var(--border-2);
    flex-shrink: 0;
  }

  .agent-pill {
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
  .agent-pill:hover { border-color: var(--accent); background: var(--bg-elev2); }
  .glyph-tile {
    width: 24px;
    height: 24px;
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
  .status-dot.online {
    background: var(--ok);
    border-color: var(--ok);
  }
  .status-dot.connecting {
    background: var(--warn);
    border-color: var(--warn);
    animation: ocrc-pulse 1.2s ease-in-out infinite;
  }
  .status-dot.offline {
    background: transparent;
    border: 1.5px solid var(--text-4);
  }
  .name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .host {
    font-size: 11px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .caret {
    font-size: 9px;
    color: var(--text-3);
    flex-shrink: 0;
  }

  .collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-3);
    cursor: pointer;
    transition: color .12s ease, background .12s ease, border-color .12s ease;
    flex-shrink: 0;
  }
  .collapse:hover { color: var(--text); background: var(--bg-elev); border-color: var(--border); }

  .picker {
    position: absolute;
    top: calc(100% + 6px);
    left: 12px;
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
  .picker-list {
    max-height: 320px;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .agent-row {
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
  .agent-row:hover, .agent-row.selected { background: var(--accent-2); }
  .row-tile {
    width: 30px;
    height: 30px;
    display: inline-grid;
    place-items: center;
    border-radius: 7px;
    border: 1px solid transparent;
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .row-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }
  .row-name {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-host {
    font-size: 10.5px;
    color: var(--text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .check {
    font-size: 13px;
    color: var(--accent);
    flex-shrink: 0;
  }

  .picker-footer {
    border-top: 1px solid var(--border);
    padding: 10px;
  }
  .theme-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .theme-label {
    font-size: 10.5px;
    color: var(--text-3);
  }
  .swatches {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .swatch {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    transition: transform .12s ease, border-color .12s ease;
  }
  .swatch:hover { transform: scale(1.1); }
  .swatch.active { border-color: var(--text); }
  .auto {
    margin-left: auto;
    padding: 3px 9px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: 10.5px;
    cursor: pointer;
    transition: color .12s ease, border-color .12s ease, background .12s ease;
  }
  .auto:hover, .auto.active { color: var(--text); border-color: var(--accent); background: var(--accent-2); }

  .list { flex: 1; overflow-y: auto; min-height: 0; }
  .footer {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px 12px;
    font-size: 10px;
    color: var(--text-4);
    border-top: 1px solid var(--border-2);
    flex-shrink: 0;
  }
  .sep { color: var(--border); }
</style>
