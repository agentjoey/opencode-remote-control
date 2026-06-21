<!-- src/lib/components/Inspector.svelte -->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { sessionList, feeds } from '$lib/stores/sessions.js'
  import { can } from '$lib/stores/capabilities.js'
  import TaskPanel from './inspector/TaskPanel.svelte'
  import McpPanel from './inspector/McpPanel.svelte'
  import UsagePanel from './inspector/UsagePanel.svelte'
  import ContextPanel from './inspector/ContextPanel.svelte'
  import WorkingDirPanel from './inspector/WorkingDirPanel.svelte'
  export let sessionId: string | undefined = undefined

  $: session = $sessionList.find((s) => s.id === sessionId)
  $: title = session?.title

  // Debounced "activity tick": bump ~1s after the feed's lastSeq changes so
  // panels refetch when a turn produces output, without hammering per delta.
  let tick = 0
  let lastSeen = -1
  let timer: ReturnType<typeof setTimeout> | undefined
  $: seq = sessionId ? ($feeds[sessionId]?.lastSeq ?? 0) : 0
  $: if (seq !== lastSeen) { lastSeen = seq; clearTimeout(timer); timer = setTimeout(() => (tick += 1), 1000) }
  onDestroy(() => clearTimeout(timer))
</script>

<aside class="inspector">
  <div class="head">
    <div class="section-label">Session</div>
    <div class="name" title={title ?? sessionId}>
      <span class="title-text">{title || (sessionId ? '…' + sessionId.slice(-8) : 'No session')}</span>
    </div>
  </div>
  {#if $can('todos')}<TaskPanel {sessionId} {tick} />{/if}
  <div class="pinned">
    {#if $can('mcp')}
      <McpPanel {tick} />
      <div class="divider"></div>
    {/if}
    <UsagePanel {sessionId} {tick} />
    <div class="divider"></div>
    <ContextPanel {sessionId} {tick} />
    <div class="divider"></div>
    <WorkingDirPanel {sessionId} {tick} showDiff={$can('diff')} />
  </div>
</aside>

<style>
  .inspector {
    width: 280px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-panel);
    border-left: 1px solid var(--border-2);
  }
  .head {
    padding: 14px 16px;
    border-bottom: 1px solid var(--border-2);
  }
  .section-label {
    text-transform: uppercase;
    letter-spacing: .16em;
    color: var(--text-3);
    font-size: 10px;
  }
  .name {
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
  }
  .title-text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pinned {
    border-top: 1px solid var(--border-2);
    padding: 14px 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .divider {
    border-top: 1px solid var(--border-2);
  }
</style>
