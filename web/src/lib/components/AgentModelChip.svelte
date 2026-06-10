<!-- src/lib/components/AgentModelChip.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { api } from '$lib/api/client.js'
  let open = false
  let agents: Array<{ name: string; model: string }> = []
  let current = { agent: null as string | null, model: null as { providerID: string; modelID: string } | null }

  async function refresh() {
    try { [agents, current] = await Promise.all([api.agents(), api.getOverrides()]) } catch { /* ignore */ }
  }
  onMount(refresh)

  function parseModel(m: string) { const i = m.indexOf('/'); return i > 0 ? { providerID: m.slice(0, i), modelID: m.slice(i + 1) } : null }
  async function pick(a: { name: string; model: string }) {
    await api.setOverrides({ agent: a.name, model: parseModel(a.model) })
    await refresh(); open = false
  }
  async function clear() { await api.setOverrides({ agent: null, model: null }); await refresh(); open = false }

  $: label = current.agent ? `${current.agent}${current.model ? ' · ' + current.model.modelID : ''}` : 'default'
</script>

<div class="wrap">
  <button class="chip mono" on:click={() => (open = !open)}>⚙ {label} ▾</button>
  {#if open}
    <div class="pop">
      <div class="label">Agent</div>
      {#each agents as a}
        <button class="opt" class:sel={a.name === current.agent} on:click={() => pick(a)}>
          {a.name} <span class="label mono">{a.model.split('/').pop()}</span>
        </button>
      {/each}
      <button class="opt clear" on:click={clear}>✕ clear override</button>
    </div>
  {/if}
</div>

<style>
  .wrap { position: relative; }
  .chip { display: flex; align-items: center; gap: 5px; background: var(--accent-2); border: 1px solid var(--accent); color: #9db4e0; border-radius: var(--radius-sm); padding: 6px 8px; font-size: 11px; white-space: nowrap; cursor: pointer; }
  .pop { position: absolute; bottom: 38px; left: 0; width: 220px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; box-shadow: 0 12px 30px rgba(0,0,0,.5); z-index: 50; }
  .opt { display: flex; justify-content: space-between; width: 100%; background: transparent; border: none; color: var(--text); padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; }
  .opt:hover, .opt.sel { background: var(--accent-2); }
  .clear { color: var(--text-3); margin-top: 4px; }
</style>
