<!-- src/lib/components/SessionRail.svelte -->
<script lang="ts">
  import SessionList from './SessionList.svelte'
  import { api } from '$lib/api/client.js'
  import { sessionList } from '$lib/stores/sessions.js'
  export let activeId: string | undefined = undefined
  let expanded = false
  let cleaning = false

  async function cleanupSubagents() {
    if (cleaning) return
    if (!confirm('删除所有 subagent 子会话？此操作不可逆，可能影响父会话的历史引用。')) return
    cleaning = true
    try {
      const { deleted } = await api.cleanupSubagents()
      sessionList.set(await api.sessions())
      if (deleted === 0) alert('没有可清理的 subagent 子会话。')
    } catch (e) {
      alert(`清理失败：${(e as Error).message}`)
    } finally {
      cleaning = false
    }
  }
</script>

<div class="rail" class:expanded>
  <div class="spine">
    <button class="toggle" class:on={expanded} title="Sessions" aria-label="Toggle sessions"
            on:click={() => (expanded = !expanded)}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg>
    </button>
  </div>
  {#if expanded}
    <div class="panel">
      <div class="phead">
        <span class="label">Sessions</span>
        <button class="clean" title="清理 subagent 子会话" disabled={cleaning} on:click={cleanupSubagents}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          {cleaning ? '…' : 'subagents'}
        </button>
      </div>
      <div class="list"><SessionList {activeId} /></div>
    </div>
  {/if}
</div>

<style>
  .rail { display: flex; height: 100%; border-right: 1px solid var(--border-2); background: var(--bg-panel); }
  .spine { width: 46px; display: flex; justify-content: center; padding-top: 10px; flex-shrink: 0; }
  .toggle {
    width: 32px; height: 32px;
    display: inline-flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--text-3); cursor: pointer;
    transition: background .12s ease, color .12s ease;
  }
  .toggle:hover { background: var(--bg-elev); color: var(--text); }
  .toggle.on { color: var(--accent); }
  .panel { display: flex; flex-direction: column; width: 240px; border-left: 1px solid var(--border-2); overflow: hidden; }
  .phead { display: flex; align-items: center; justify-content: space-between; padding: 12px 12px 8px 14px; }
  .clean {
    display: inline-flex; align-items: center; gap: 5px;
    background: transparent; border: 1px solid var(--border);
    color: var(--text-3); border-radius: 20px; padding: 3px 9px;
    font-size: 10.5px; cursor: pointer;
    transition: border-color .12s, color .12s;
  }
  .clean:hover:not(:disabled) { border-color: var(--err); color: var(--err); }
  .clean:disabled { opacity: .5; cursor: default; }
  .list { flex: 1; overflow-y: auto; }
</style>
