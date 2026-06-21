<script lang="ts">
  import { api } from '$lib/api/client.js'

  export let sessionId: string

  type ControlOption = { id: string; name: string }
  type ControlGroup = { current?: string; options: ControlOption[] }
  type Controls = { mode?: ControlGroup; model?: ControlGroup }

  let controls: Controls = {}
  let openPanel: 'mode' | 'model' | null = null

  async function load() {
    try { controls = await api.controls(sessionId) } catch { controls = {} }
  }

  $: if (sessionId) load()

  async function pickMode(id: string) {
    if (controls.mode) controls.mode = { ...controls.mode, current: id }
    openPanel = null
    try { await api.setMode(sessionId, id) } catch { /* ignore */ }
    await load()
  }

  async function pickModel(id: string) {
    if (controls.model) controls.model = { ...controls.model, current: id }
    openPanel = null
    try { await api.setModel(sessionId, id) } catch { /* ignore */ }
    await load()
  }

  function toggle(panel: 'mode' | 'model') {
    openPanel = openPanel === panel ? null : panel
  }

  $: modeOpts = controls.mode?.options ?? []
  $: modelOpts = controls.model?.options ?? []
  $: modeLabel = controls.mode?.options.find(o => o.id === controls.mode?.current)?.name ?? controls.mode?.current ?? 'mode'
  $: modelLabel = controls.model?.options.find(o => o.id === controls.model?.current)?.name ?? controls.model?.current ?? 'model'
</script>

{#if modeOpts.length > 0}
  <div class="wrap">
    <button class="chip mono" on:click={() => toggle('mode')}>⚡ {modeLabel} ▾</button>
    {#if openPanel === 'mode'}
      <div class="pop">
        <div class="label">Mode</div>
        {#each modeOpts as o}
          <button class="opt" class:sel={o.id === controls.mode?.current} on:click={() => pickMode(o.id)}>
            {o.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

{#if modelOpts.length > 0}
  <div class="wrap">
    <button class="chip mono" on:click={() => toggle('model')}>🧠 {modelLabel} ▾</button>
    {#if openPanel === 'model'}
      <div class="pop">
        <div class="label">Model</div>
        {#each modelOpts as o}
          <button class="opt" class:sel={o.id === controls.model?.current} on:click={() => pickModel(o.id)}>
            {o.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .wrap { position: relative; }
  .chip { display: flex; align-items: center; gap: 5px; background: transparent; border: 1px solid var(--border); color: var(--text-2); border-radius: 20px; padding: 5px 11px; font-size: 11.5px; white-space: nowrap; cursor: pointer; transition: border-color .15s, color .15s; }
  .chip:hover { border-color: var(--accent); color: var(--text); }
  .pop { position: absolute; bottom: 44px; left: 0; width: 220px; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); padding: 8px; box-shadow: 0 16px 40px rgba(0,0,0,.5); z-index: 100; }
  .opt { display: flex; align-items: center; width: 100%; background: transparent; border: none; color: var(--text); padding: 6px 8px; border-radius: var(--radius-sm); cursor: pointer; font-size: 12px; }
  .opt:hover, .opt.sel { background: var(--accent-2); }
</style>
