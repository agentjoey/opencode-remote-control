<!-- src/lib/components/inspector/ContextPanel.svelte -->
<script lang="ts">
  import { api } from '$lib/api/client.js'
  export let sessionId: string | undefined = undefined
  export let tick = 0
  let ctx: any = {}
  async function load(id?: string) { if (!id) { ctx = {}; return } try { ctx = await api.context(id) } catch { /* keep */ } }
  $: load(sessionId), tick
  function k(n?: number) { return n == null ? '—' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n) }
  $: tin = ctx?.tokens?.input as number | undefined
  $: tout = ctx?.tokens?.output as number | undefined
</script>
<div class="ctx">
  <div class="label">Context</div>
  <div class="body">
    {#if ctx?.model}<span class="mono">{String(ctx.model).split('/').pop()}</span>{/if}
    ↑{k(tin)} ↓{k(tout)}{#if typeof ctx?.cost === 'number'} · 💰${ctx.cost.toFixed(3)}{/if}
  </div>
</div>
<style>
  .ctx { font-size: 11px; } .body { color: var(--text-2); margin-top: 4px; }
</style>
