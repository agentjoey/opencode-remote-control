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
  {#if files.length}<div class="files mono">{#each files as f}<div>✏️ {f}</div>{/each}</div>{/if}
  {#if !dir && files.length === 0}<div class="label">—</div>{/if}
</div>
<style>
  .wd { font-size: 11px; } .path { color: var(--text-2); margin: 3px 0; } .files { color: var(--text-2); }
</style>
