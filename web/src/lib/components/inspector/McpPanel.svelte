<!-- src/lib/components/inspector/McpPanel.svelte -->
<script lang="ts">
  import { api } from '$lib/api/client.js'
  export let tick = 0
  let servers: Array<{ name: string; status: string }> = []
  async function load() { try { servers = await api.mcp() } catch { /* keep */ } }
  $: load(), tick
</script>
<div class="mcp">
  <div class="label">MCP</div>
  <div class="list">
    {#each servers as m}<div class="row" class:off={m.status === 'disabled'}>{m.status === 'disabled' ? '⚪' : '🟢'} {m.name}</div>{/each}
    {#if servers.length === 0}<div class="label">none</div>{/if}
  </div>
</div>
<style>
  .mcp { font-size: 11px; }
  .list { display: flex; flex-direction: column; gap: 2px; color: var(--text-2); margin-top: 4px; }
  .row.off { color: var(--text-3); }
</style>
