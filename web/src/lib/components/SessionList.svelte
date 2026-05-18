<script lang="ts">
  import { sessionList } from '../stores/sessions.js'
  import type { SessionSummary } from '../api/types.js'

  // PWA passes activeId from $page.params and relies on <a href> for routing.
  // Extension passes onSelect (and no <a href> navigation happens).
  export let activeId: string | undefined = undefined
  export let onSelect: ((id: string) => void) | undefined = undefined

  function formatTime(ts: number): string {
    const diff = Date.now() - ts * 1000
    const m = Math.floor(diff / 60000)
    if (m < 1) return 'now'
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}d`
  }

  function handleClick(e: MouseEvent, id: string) {
    if (onSelect) {
      e.preventDefault()
      onSelect(id)
    }
  }
</script>

<div class="sidebar">
  {#each $sessionList as s (s.id)}
    <a
      href="/{s.id}/"
      class="session"
      class:active={activeId === s.id}
      on:click={(e) => handleClick(e, s.id)}
    >
      <div class="row">
        <span class="agent">{s.agent ?? 'opencode'}</span>
        <span class="time">{formatTime(s.lastActiveAt)}</span>
      </div>
      {#if s.title}
        <div class="title">{s.title}</div>
      {/if}
    </a>
  {/each}
</div>

<style>
  .sidebar {
    width: 240px;
    border-right: 1px solid #222;
    background: #0f0f0f;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .session {
    text-align: left;
    padding: 10px 14px;
    border: none;
    border-bottom: 1px solid #1a1a1a;
    background: transparent;
    color: #ccc;
    cursor: pointer;
  }
  .session:hover, .session.active {
    background: #1a1a1a;
  }
  .session.active {
    border-left: 3px solid #2563eb;
  }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .agent {
    font-weight: 600;
    font-size: 0.9em;
  }
  .time {
    font-size: 0.75em;
    color: #888;
  }
  .title {
    font-size: 0.8em;
    color: #888;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
