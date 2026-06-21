<!-- src/lib/components/inspector/ContextPanel.svelte -->
<script lang="ts">
  import { api } from '$lib/api/client.js'

  export let sessionId: string | undefined = undefined
  export let tick = 0

  let ctx: Record<string, any> = {}

  async function load(id?: string) {
    if (!id) {
      ctx = {}
      return
    }
    try {
      ctx = await api.context(id)
    } catch {
      /* keep last valid context on transient failures */
    }
  }

  $: load(sessionId), tick

  $: tin = typeof ctx?.tokens?.input === 'number' ? (ctx.tokens.input as number) : undefined
  $: tout = typeof ctx?.tokens?.output === 'number' ? (ctx.tokens.output as number) : undefined
  $: used = tin != null || tout != null ? (tin ?? 0) + (tout ?? 0) : undefined
  $: max = typeof ctx?.tokens?.max === 'number' ? (ctx.tokens.max as number) : undefined
  $: pct = used != null && max != null ? Math.min(100, Math.round((used / max) * 100)) : undefined
  $: model = ctx?.model ? String(ctx.model).split('/').pop() : undefined

  function fmt(n?: number) {
    return n == null ? '—' : n.toLocaleString()
  }
</script>

<div class="ctx">
  <div class="hd">
    <span class="section-label">Context</span>
    {#if pct != null}<span class="pct">{pct}%</span>{/if}
  </div>
  <div class="body mono">
    <span class="big">{fmt(used)}</span>
    {#if max != null}
      <span class="max">/ {fmt(max)} tokens</span>
    {:else}
      <span class="max">tokens</span>
    {/if}
  </div>
  {#if pct != null}
    <div class="bar"><div class="fill" style="width:{pct}%"></div></div>
  {/if}
  {#if model}
    <div class="model mono"><span class="sq"></span>{model}</div>
  {/if}
</div>

<style>
  .ctx {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .section-label {
    text-transform: uppercase;
    letter-spacing: .16em;
    color: var(--text-3);
    font-size: 10px;
  }
  .pct {
    font-family: var(--font-mono);
    color: var(--text-2);
    font-size: 11px;
  }
  .body {
    display: flex;
    align-items: baseline;
    gap: 6px;
    color: var(--text);
  }
  .big {
    font-family: var(--font-mono);
    font-size: 20px;
    font-weight: 600;
  }
  .max {
    font-family: var(--font-mono);
    color: var(--text-3);
    font-size: 11px;
  }
  .bar {
    height: 7px;
    background: var(--bg-input);
    border-radius: 3.5px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--user-bubble);
    transition: width .3s ease;
  }
  .model {
    display: flex;
    align-items: center;
    gap: 7px;
    color: var(--text-2);
    font-size: 11px;
  }
  .sq {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    background: var(--hl-cyan);
  }
</style>
