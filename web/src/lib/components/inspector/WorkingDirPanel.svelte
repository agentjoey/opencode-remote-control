<!-- src/lib/components/inspector/WorkingDirPanel.svelte -->
<script lang="ts">
  import { api } from '$lib/api/client.js'
  export let sessionId: string | undefined = undefined
  export let tick = 0
  let dir = ''
  let files: string[] = []
  async function load(id?: string) {
    if (!id) { dir = ''; files = []; return }
    try {
      const [ctx, diff] = await Promise.all([api.context(id), api.diff(id)])
      dir = (ctx as any)?.directory ?? ''
      files = (Array.isArray(diff) ? diff : []).map((d: any) => d?.path).filter(Boolean).slice(0, 8)
    } catch { /* keep */ }
  }
  $: load(sessionId), tick
  function short(p: string) { const parts = p.split('/'); return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p }
</script>
<div class="wd">
  <div class="label">Working dir</div>
  {#if dir}<div class="path mono">{short(dir)}</div>{/if}
  {#if files.length}<div class="files mono">{#each files as f}<div class="f"><span class="m">M</span>{short(f)}</div>{/each}</div>{/if}
  {#if !dir && files.length === 0}<div class="label">—</div>{/if}
</div>
<style>
  .wd { font-size: 11px; } .path { color: var(--text-2); margin: 4px 0 6px; }
  .files { color: var(--text-2); display: flex; flex-direction: column; gap: 3px; }
  .f { display: flex; align-items: center; gap: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .m { color: var(--warn); flex-shrink: 0; font-weight: 600; }
</style>
