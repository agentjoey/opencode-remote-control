<!-- src/lib/components/SessionRail.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation'
  import pkg from '../../../package.json'
  import SessionList from './SessionList.svelte'
  import WorkspaceSwitcher from './WorkspaceSwitcher.svelte'
  import { api } from '$lib/api/client.js'
  import { sessionList } from '$lib/stores/sessions.js'
  import { connection } from '$lib/stores/connection.js'
  import { activeWorkspace, workspaces } from '$lib/stores/workspaces.js'
  export let activeId: string | undefined = undefined
  // Drawer mode (mobile): panel fills the off-canvas drawer.
  export let drawer = false

  let creating = false

  const ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000
  function isOnline(lastActiveAt: number, conn: string): boolean {
    return conn === 'connected' && Date.now() - lastActiveAt < ACTIVE_WINDOW_MS
  }

  $: activeCount = $sessionList.filter((s) => isOnline(s.lastActiveAt, $connection)).length

  async function newSession() {
    if (creating) return
    const directory = ($activeWorkspace as string | null) || $workspaces[0]?.directory || ''
    creating = true
    try {
      const res = await api.createSession({ directory })
      sessionList.set(await api.sessions())
      workspaces.set(await api.workspaces())
      goto(`/${res.id}/`)
    } catch (e) {
      alert(`创建会话失败：${(e as Error).message}`)
    } finally {
      creating = false
    }
  }
</script>

<div class="rail" class:drawer>
  <div class="panel">
    <div class="phead">
      <span class="label">Sessions</span>
      <button class="new" title="New session" aria-label="New session" disabled={creating} on:click={newSession}>
        {creating ? '…' : '+'}
      </button>
    </div>
    <WorkspaceSwitcher />
    <div class="list"><SessionList {activeId} /></div>
    <div class="footer mono">
      <span class="dot"></span>
      <span>{activeCount} active</span>
      <span class="sep">·</span>
      <span class="version">v{pkg.version}</span>
    </div>
  </div>
</div>

<style>
  .rail {
    display: flex;
    height: 100%;
    width: 268px;
    border-right: 1px solid var(--border-2);
    background: var(--bg-panel);
    flex-shrink: 0;
  }
  .rail.drawer { width: 100%; border-right: none; }
  .panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    overflow: hidden;
  }
  .phead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px 8px;
  }
  .label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .16em;
    color: var(--text-3);
  }
  .new {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    background: transparent;
    border: 1px solid var(--border-2);
    border-radius: var(--radius-sm);
    color: var(--text-3);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
    transition: border-color .12s ease, color .12s ease;
  }
  .new:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
  .new:disabled { opacity: .5; cursor: default; }
  .list { flex: 1; overflow-y: auto; min-height: 0; }
  .footer {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 10px 14px 12px;
    font-size: 10px;
    color: var(--text-4);
    border-top: 1px solid var(--border-2);
  }
  .footer .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--ok);
    flex-shrink: 0;
  }
  .sep { color: var(--border); }
  .version { margin-left: auto; }
</style>
