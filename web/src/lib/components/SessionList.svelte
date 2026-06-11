<script lang="ts">
  import { goto } from '$app/navigation'
  import { sessionList, feeds } from '../stores/sessions.js'
  import { pinnedSessions } from '../stores/pins.js'
  import { activeWorkspace } from '../stores/workspaces.js'
  import { filterByWorkspace } from '../nav/workspaceFilter.js'
  import { api } from '../api/client.js'
  import type { SessionSummary } from '../api/types.js'

  // PWA passes activeId from $page.params and relies on <a href> for routing.
  // Extension passes onSelect (and no <a href> navigation happens).
  export let activeId: string | undefined = undefined
  export let onSelect: ((id: string) => void) | undefined = undefined

  // A session is "busy" if the tail of its live feed is a thinking/streaming card.
  function isBusy(sid: string, all: typeof $feeds): boolean {
    const f = all[sid]
    if (!f || f.order.length === 0) return false
    const last = f.byId[f.order[f.order.length - 1]]
    return last?.kind === 'thinking' || last?.kind === 'streaming' || last?.kind === 'think-stream'
  }

  function formatTime(ts: number): string {
    // opencode timestamps are epoch milliseconds.
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

  let deleting: string | null = null
  async function deleteSession(e: MouseEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    if (deleting) return
    if (!confirm('删除该会话？此操作不可逆。')) return
    deleting = id
    try {
      await api.deleteSession(id)
      sessionList.set(await api.sessions())
      if (activeId === id) goto('/')
    } catch (err) {
      alert(`删除失败：${(err as Error).message}`)
    } finally {
      deleting = null
    }
  }

  // Filter to the active workspace (null = all), then sort most-recent first
  // and split into pinned / recent groups.
  $: visible = filterByWorkspace($sessionList, $activeWorkspace)
  $: byRecent = [...visible].sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  $: pinned = byRecent.filter((s) => $pinnedSessions.includes(s.id))
  $: recent = byRecent.filter((s) => !$pinnedSessions.includes(s.id))
</script>

<div class="sidebar">
  {#each [{ key: 'pinned', label: 'Pinned', rows: pinned }, { key: 'recent', label: pinned.length ? 'Recent' : '', rows: recent }] as group (group.key)}
    {#if group.rows.length}
      {#if group.label}<div class="group label">{group.label}</div>{/if}
      {#each group.rows as s (s.id)}
        <a
          href="/{s.id}/"
          class="session"
          class:active={activeId === s.id}
          on:click={(e) => handleClick(e, s.id)}
        >
          <div class="line1">
            <span class="dot" class:busy={isBusy(s.id, $feeds)}></span>
            <span class="title">{s.title || 'Untitled session'}</span>
            <span class="actions">
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
                title="删除会话"
                aria-label="Delete session"
                disabled={deleting === s.id}
                on:click={(e) => deleteSession(e, s.id)}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              </button>
            </span>
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
        </a>
      {/each}
    {/if}
  {/each}
  {#if visible.length === 0}
    <div class="empty label">No sessions</div>
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
    padding: 6px;
    gap: 2px;
  }
  .group { padding: 10px 8px 4px; }
  .group:first-child { padding-top: 4px; }
  .session {
    position: relative;
    display: block;
    text-decoration: none;
    padding: 9px 12px 9px 14px;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    transition: background .12s ease;
  }
  .session:hover { background: var(--bg-elev); }
  .session.active { background: var(--accent-2); }
  /* emerald active marker — matches brand + user bubble */
  .session.active::before {
    content: '';
    position: absolute;
    left: 0; top: 8px; bottom: 8px;
    width: 3px; border-radius: 3px;
    background: var(--accent);
  }

  .line1 { display: flex; align-items: center; gap: 7px; }
  .dot {
    width: 7px; height: 7px; border-radius: 50%;
    border: 1.5px solid var(--text-3);
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .dot.busy {
    border-color: var(--accent);
    background: var(--accent);
    animation: pulse 1.2s ease-in-out infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
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
  .act.pin.on { opacity: 1; color: var(--accent); }
  .act.trash:hover { color: var(--err); }
  .act:disabled { opacity: .4; cursor: default; }

  .meta {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    font-size: 11px;
    color: var(--text-3);
    margin: 4px 0 0 14px;
  }
  .sep { color: var(--border); }
  .id { color: var(--text-2); }
  .repo { color: var(--text-2); }
  .add { color: var(--ok); }
  .del { color: var(--err); }
  .empty { padding: 16px 12px; }
</style>
