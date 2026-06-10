<!-- src/lib/components/Inspector.svelte -->
<script lang="ts">
  export let sessionId: string | undefined = undefined
  import { sessionList } from '$lib/stores/sessions.js'
  $: title = $sessionList.find((s) => s.id === sessionId)?.title
</script>

<aside class="inspector">
  <div class="head">
    <div class="label">Session</div>
    <div class="name">{title ?? (sessionId ? '…' + sessionId.slice(-8) : 'No session')}</div>
  </div>
  <!-- Plan 3 fills these regions: -->
  <div class="task"><div class="label">Task</div><div class="ph label">—</div></div>
  <div class="fixed">
    <div class="label">MCP</div><div class="ph label">—</div>
    <div class="label">Context</div><div class="ph label">—</div>
    <div class="label">Working dir</div><div class="ph label">—</div>
  </div>
</aside>

<style>
  .inspector { width: 252px; display: flex; flex-direction: column; background: var(--bg-panel); border-left: 1px solid var(--border-2); }
  .head { padding: 9px 12px; border-bottom: 1px solid var(--border-2); }
  .name { font-weight: 600; }
  .task { flex: 1; overflow: auto; padding: 11px 12px; }
  .fixed { border-top: 1px solid var(--border-2); padding: 10px 12px; background: var(--bg); }
  .ph { margin: 4px 0 12px; }
</style>
