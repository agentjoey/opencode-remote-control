<!-- src/lib/components/Inspector.svelte -->
<script lang="ts">
  import { onDestroy } from 'svelte'
  import { sessionList, feeds } from '$lib/stores/sessions.js'
  import TaskPanel from './inspector/TaskPanel.svelte'
  import McpPanel from './inspector/McpPanel.svelte'
  import ContextPanel from './inspector/ContextPanel.svelte'
  import WorkingDirPanel from './inspector/WorkingDirPanel.svelte'
  export let sessionId: string | undefined = undefined
  $: title = $sessionList.find((s) => s.id === sessionId)?.title

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
    <div class="label">Session</div>
    <div class="name" title={title ?? sessionId}>{title || (sessionId ? '…' + sessionId.slice(-8) : 'No session')}</div>
  </div>
  <TaskPanel {sessionId} {tick} />
  <div class="fixed">
    <McpPanel {tick} />
    <div class="div"></div>
    <ContextPanel {sessionId} {tick} />
    <div class="div"></div>
    <WorkingDirPanel {sessionId} {tick} />
  </div>
</aside>

<style>
  .inspector { width: 260px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--bg-panel); border-left: 1px solid var(--border-2); }
  .head { padding: 11px 14px; border-bottom: 1px solid var(--border-2); }
  .name {
    margin-top: 3px;
    font-weight: 600;
    font-size: 13px;
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .fixed { border-top: 1px solid var(--border-2); padding: 12px 14px 18px; background: var(--bg); display: flex; flex-direction: column; gap: 10px; }
  .div { border-top: 1px solid var(--border-2); }
</style>
