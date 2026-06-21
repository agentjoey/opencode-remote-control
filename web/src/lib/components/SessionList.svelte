<script lang="ts">
  import { goto } from '$app/navigation'
  import { sessionList, feeds } from '../stores/sessions.js'
  import { pinnedSessions } from '../stores/pins.js'
  import { activeWorkspace } from '../stores/workspaces.js'
  import { filterByWorkspace } from '../nav/workspaceFilter.js'
  import { connection } from '../stores/connection.js'
  import { api } from '../api/client.js'
  import type { SessionSummary } from '../api/types.js'

  // PWA passes activeId from $page.params and relies on <a href> for routing.
  // Extension passes onSelect (and no <a href> navigation happens).
  export let activeId: string | undefined = undefined
  export let onSelect: ((id: string) => void) | undefined = undefined
  // v2: the list shows only the selected agent's sessions.
  export let agentId: string | undefined = undefined
  export let agentName: string | undefined = undefined

  const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000
  function isOnline(lastActiveAt: number, conn: string): boolean {
    return conn === 'connected' && Date.now() - lastActiveAt < ACTIVE_WINDOW_MS
  }

  // A session is "busy" if the tail of its live feed is a thinking/streaming card.
  function isBusy(sid: string, all: typeof $feeds): boolean {
    const f = all[sid]
    if (!f || f.order.length === 0) return false
    const last = f.byId[f.order[f.order.length - 1]]
    return last?.kind === 'thinking' || last?.kind === 'streaming' || last?.kind === 'think-stream'
  }

  // A session is "waiting" if the tail of its feed is an unresolved approval card.
  function isWaiting(sid: string, all: typeof $feeds): boolean {
    const f = all[sid]
    if (!f || f.order.length === 0) return false
    const last = f.byId[f.order[f.order.length - 1]]
    return last?.kind === 'approval'
  }

  type Status = 'busy' | 'wait' | 'idle' | 'offline'
  function sessionStatus(s: SessionSummary): Status {
    if (isBusy(s.id, $feeds)) return 'busy'
    if (isWaiting(s.id, $feeds)) return 'wait'
    if (isOnline(s.lastActiveAt, $connection)) return 'idle'
    return 'offline'
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

  // Last 8 chars of the id, minus any "ses_"-style prefix.
  function shortId(id: string): string {
    const bare = id.includes('_') ? id.slice(id.indexOf('_') + 1) : id
    return bare.slice(-8)
  }

  function repoName(dir?: string): string {
    if (!dir) return ''
    const parts = dir.replace(/\/+$/, '').split('/')
    return parts[parts.length - 1] || ''
  }

  function handleClick(e: MouseEvent, id: string) {
    if (onSelect) {
      e.preventDefault()
      onSelect(id)
    }
  }

  function togglePin(e: MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    pinnedSessions.toggle(id)
  }

  // Inline rename state.
  let editing: string | null = null
  let draft = ''
  let renaming: string | null = null

  function startRename(e: MouseEvent, s: SessionSummary) {
    e.preventDefault()
    e.stopPropagation()
    editing = s.id
    draft = s.title || ''
  }

  function cancelRename() {
    editing = null
    draft = ''
  }

  async function submitRename(id: string) {
    const title = draft.trim()
    if (!title || renaming) { cancelRename(); return }
    renaming = id
    try {
      await api.renameSession(id, title)
      sessionList.set(await api.sessions())
    } catch (err) {
      alert(`Rename failed: ${(err as Error).message}`)
    } finally {
      renaming = null
      editing = null
      draft = ''
    }
  }

  function onRenameKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter') { e.preventDefault(); submitRename(id) }
    else if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
  }

  function focusInput(node: HTMLInputElement) {
    node.focus()
    node.select()
  }

  let deleting: string | null = null
  async function deleteSession(e: MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    if (deleting) return
    if (!confirm('Delete this session? This cannot be undone.')) return
    deleting = id
    try {
      await api.deleteSession(id)
      sessionList.set(await api.sessions())
      if (activeId === id) goto('/')
    } catch (err) {
      alert(`Delete failed: ${(err as Error).message}`)
    } finally {
      deleting = null
    }
  }

  // The session list shows only the selected agent's sessions (fallback for legacy sessions with no backendId).
  $: byAgent = agentId
    ? $sessionList.filter((s) => s.backendId === agentId || (!s.backendId && agentId === 'opencode'))
    : $sessionList
  // Filter to the active workspace, then sort most-recent first and split pinned / recent.
  $: visible = filterByWorkspace(byAgent, $activeWorkspace)
  $: byRecent = [...visible].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  $: pinned = byRecent.filter((s) => $pinnedSessions.includes(s.id))
  $: recent = byRecent.filter((s) => !$pinnedSessions.includes(s.id))
  $: groups = [
    { key: 'pinned', label: 'Pinned', rows: pinned },
    { key: 'recent', label: 'Recent', rows: recent },
  ]
</script>

<div class="sidebar">
  {#each groups as group (group.key)}
    {#if group.rows.length}
      <div class="group-header mono">
        <span class="gh-label">{group.label}</span>
        <span class="gh-line" aria-hidden="true"></span>
        <span class="gh-count">{group.rows.length}</span>
      </div>
      {#each group.rows as s (s.id)}
        <a
          href="/{s.id}/"
          class="session"
          class:active={activeId === s.id}
          class:busy={sessionStatus(s) === 'busy'}
          on:click={(e) => handleClick(e, s.id)}
        >
          <div class="line1">
            <span class="dot {sessionStatus(s)}"></span>
            {#if editing === s.id}
              <input
                class="rename-input"
                bind:value={draft}
                disabled={renaming === s.id}
                placeholder="Session title"
                use:focusInput
                on:click={(e) => e.preventDefault()}
                on:keydown={(e) => onRenameKey(e, s.id)}
                on:blur={() => submitRename(s.id)}
              />
            {:else}
              <span class="title">{s.title || 'Untitled session'}</span>
              {#if $pinnedSessions.includes(s.id)}<span class="pin-dot" aria-label="Pinned">●</span>{/if}
              <span class="actions">
                <button
                  class="act rename"
                  title="Rename session"
                  aria-label="Rename session"
                  on:click={(e) => startRename(e, s)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
                </button>
                <button
                  class="act pin"
                  class:on={$pinnedSessions.includes(s.id)}
                  title={$pinnedSessions.includes(s.id) ? 'Unpin' : 'Pin'}
                  aria-label="Pin session"
                  on:click={(e) => togglePin(e, s.id)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={$pinnedSessions.includes(s.id) ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3v2H7v-2l3-3-1-6z"/><line x1="12" y1="15" x2="12" y2="21"/></svg>
                </button>
                <button
                  class="act trash"
                  title="Delete session"
                  aria-label="Delete session"
                  disabled={deleting === s.id}
                  on:click={(e) => deleteSession(e, s.id)}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
              </span>
            {/if}
          </div>
          <div class="meta mono">
            <span class="id">{shortId(s.id)}</span>
            {#if repoName(s.directory)}<span class="sep">·</span><span class="repo">{repoName(s.directory)}</span>{/if}
            <span class="sep">·</span><span>{formatTime(s.lastActiveAt)}</span>
            {#if s.additions || s.deletions}
              <span class="sep">·</span>
              {#if s.additions}<span class="add">+{s.additions}</span>{/if}
              {#if s.deletions}<span class="del">−{s.deletions}</span>{/if}
            {/if}
          </div>
          {#if sessionStatus(s) === 'busy'}
            <div class="progress" aria-hidden="true"><span class="progress-fill"></span></div>
          {/if}
        </a>
      {/each}
    {/if}
  {/each}
  {#if visible.length === 0}
    <div class="empty mono">no sessions on {agentName ?? 'this agent'} yet</div>
  {/if}
</div>

<style>
  .sidebar {
    width: 100%;
    box-sizing: border-box;
    background: var(--bg-panel);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding: 4px 8px 8px;
    gap: 2px;
  }
  .group-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 8px 6px;
    color: var(--text-4);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: .16em;
  }
  .gh-label { flex-shrink: 0; }
  .gh-line {
    flex: 1;
    height: 1px;
    background: var(--border-2);
    opacity: .7;
  }
  .gh-count {
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }

  .session {
    position: relative;
    display: block;
    text-decoration: none;
    padding: 9px 12px 9px 16px;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    transition: background .12s ease;
  }
  .session:hover { background: var(--bg-elev); }
  .session.active {
    background: var(--accent-2);
  }
  .session.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 9px;
    bottom: 9px;
    width: 2.5px;
    border-radius: 2.5px;
    background: var(--accent);
  }

  .line1 { display: flex; align-items: center; gap: 7px; }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .dot.busy {
    background: var(--accent);
    border-color: var(--accent);
    animation: ocrc-pulse 1.2s ease-in-out infinite;
  }
  .dot.wait {
    background: var(--warn);
    border-color: var(--warn);
  }
  /* idle dot follows the active agent's theme (sessions belong to it). */
  .dot.idle {
    background: var(--accent);
    border-color: var(--accent);
  }
  .dot.offline {
    background: transparent;
    border: 1.5px solid var(--text-4);
  }

  .title {
    flex: 1;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .session.active .title { color: var(--text); }

  .pin-dot {
    flex-shrink: 0;
    font-size: 7px;
    color: var(--accent);
    line-height: 1;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    /* 16px so renaming inline doesn't trigger iOS auto-zoom. */
    font-size: 16px;
    font-weight: 600;
    color: var(--text);
    background: var(--bg-panel);
    border: 1px solid var(--accent);
    border-radius: var(--radius-sm);
    padding: 1px 6px;
    outline: none;
    font-family: inherit;
  }
  .rename-input:disabled { opacity: .6; }

  .actions { display: inline-flex; gap: 1px; flex-shrink: 0; }
  .act {
    display: inline-flex;
    background: transparent;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    padding: 2px;
    opacity: 0;
    transition: opacity .12s ease, color .12s ease;
  }
  .session:hover .act { opacity: .65; }
  .act:hover { opacity: 1; }
  .act.pin:hover { color: var(--text); }
  .act.rename:hover { color: var(--accent); }
  .act.pin.on { opacity: 1; color: var(--accent); }
  .act.trash:hover { color: var(--err); }
  .act:disabled { opacity: .4; cursor: default; }
  @media (hover: none), (max-width: 820px) {
    .act { opacity: .6; padding: 8px; }
    .actions { gap: 2px; }
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    font-size: 10.5px;
    color: var(--text-3);
    margin: 4px 0 0 16px;
  }
  .sep { color: var(--border); }
  .id { color: var(--text-2); }
  .repo { color: var(--text-2); }
  .add { color: var(--ok); }
  .del { color: var(--err); }
  .empty { padding: 16px 12px; color: var(--text-3); font-size: 11px; }

  .progress {
    height: 3px;
    margin-top: 8px;
    background: var(--border-2);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    display: block;
    width: 100%;
    height: 100%;
    background: linear-gradient(90deg, transparent 0%, var(--accent) 50%, transparent 100%);
    background-size: 200% 100%;
    animation: ocrc-shimmer 1.4s linear infinite;
  }
</style>
