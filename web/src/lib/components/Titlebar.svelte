<script lang="ts">
  import { goto } from '$app/navigation'
  import { sessionList } from '$lib/stores/sessions.js'
  import { workspaces, activeWorkspace } from '$lib/stores/workspaces.js'
  import { connection, latency } from '$lib/stores/connection.js'
  import { api } from '$lib/api/client.js'

  export let email = ''
  export let onPalette: () => void
  export let installEvent: any = null
  export let onInstall: () => void = () => {}
  export let drawerLeft = false
  export let drawerRight = false
  export let onToggleLeft: () => void = () => {}
  export let onToggleRight: () => void = () => {}

  $: userLabel = email || 'you@local'
  $: userInitial = userLabel.charAt(0).toUpperCase()

  let creating = false
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

  function statusText(status: string): string {
    if (status === 'connected') return 'live'
    if (status === 'reconnecting') return 'reconnecting'
    return 'offline'
  }
</script>

<header class="titlebar">
  <!-- Mobile session drawer toggle -->
  <button class="iconbtn" class:active={drawerLeft} on:click={onToggleLeft} aria-label="Sessions">☰</button>

  <!-- Brand mark + wordmark -->
  <div class="brand" title="opencode remote control">
    <div class="brand-mark" aria-hidden="true">
      <span class="brand-ring"></span>
      <span class="brand-ring" style="animation-delay: 1.1s"></span>
      <span class="brand-dot"></span>
    </div>
    <span class="wordmark">OCRC</span>
  </div>

  <!-- New session button -->
  <button class="new-session" on:click={newSession} disabled={creating} title="Create a new session">
    <span class="new-icon" aria-hidden="true">+</span>
    <span class="new-label">New</span>
  </button>

  <!-- Command palette trigger -->
  <button class="palette-trigger" on:click={onPalette} title="Search sessions & commands (⌘K)">
    <span class="palette-icon" aria-hidden="true">⌕</span>
    <span class="palette-label">Search sessions & commands…</span>
    <kbd class="palette-keycap mono">⌘K</kbd>
  </button>

  <span class="spacer"></span>

  <!-- Connection pill -->
  <span class="connection-pill {$connection}" title="WebSocket: {statusText($connection)}">
    <span class="dot-wrap" aria-hidden="true">
      <span class="dot"></span>
      {#if $connection === 'connected'}<span class="dot-ring"></span>{/if}
    </span>
    <span class="connection-state">{statusText($connection)}</span>
    {#if $connection === 'connected'}<span class="connection-latency mono">{$latency}ms</span>{/if}
  </span>

  {#if installEvent}<button class="install" on:click={onInstall}>Install</button>{/if}

  <!-- Mobile inspector drawer toggle -->
  <button class="iconbtn" class:active={drawerRight} on:click={onToggleRight} aria-label="Inspector">ⓘ</button>

  <!-- User -->
  <div class="user">
    <span class="user-email mono">{userLabel}</span>
    <span class="avatar mono" aria-hidden="true">{userInitial}</span>
  </div>
</header>

<style>
  .titlebar {
    display: flex;
    align-items: center;
    gap: 12px;
    height: calc(52px + env(safe-area-inset-top, 0px));
    padding: env(safe-area-inset-top, 0px) 16px 0;
    box-sizing: border-box;
    border-bottom: 1px solid var(--border);
    background: var(--bg-panel);
    flex-shrink: 0;
    font-size: 13px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .brand-mark {
    position: relative;
    width: 26px;
    height: 26px;
    border-radius: 8px;
    background: var(--accent-2);
    border: 1px solid var(--accent-line);
    display: grid;
    place-items: center;
    flex-shrink: 0;
  }
  .brand-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }
  .brand-ring {
    position: absolute;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1.5px solid var(--accent);
    opacity: 0;
    animation: ocrc-ring 2.2s ease-out infinite;
    pointer-events: none;
  }
  .wordmark {
    font-family: var(--font-mono);
    font-weight: 700;
    letter-spacing: .14em;
    color: var(--text);
    font-size: 13px;
  }

  .new-session {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--accent);
    color: var(--accent-ink);
    border: none;
    border-radius: var(--radius-sm);
    padding: 5px 11px;
    font-size: 12px;
    font-weight: 650;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity .12s ease, transform .12s ease;
  }
  .new-session:hover:not(:disabled) { opacity: .9; }
  .new-session:disabled { opacity: .5; cursor: default; }
  .new-icon { font-size: 14px; line-height: 1; }
  .new-label { white-space: nowrap; }

  .palette-trigger {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 230px;
    max-width: 340px;
    background: var(--bg-input);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--text-3);
    padding: 5px 10px;
    font-size: 12.5px;
    cursor: text;
    transition: border-color .15s ease, color .15s ease;
  }
  .palette-trigger:hover { border-color: var(--text-3); color: var(--text-2); }
  .palette-icon { font-size: 14px; opacity: .85; }
  .palette-label { flex: 1; text-align: left; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .palette-keycap {
    font-size: 10px;
    color: var(--text-3);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 2px 5px;
  }

  .spacer { flex: 1; }

  .connection-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border-radius: var(--radius-pill);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    padding: 4px 10px;
    flex-shrink: 0;
  }
  .dot-wrap {
    position: relative;
    width: 10px;
    height: 10px;
    display: grid;
    place-items: center;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--text-4);
    flex-shrink: 0;
  }
  .dot-ring {
    position: absolute;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1.5px solid var(--ok);
    opacity: 0;
    animation: ocrc-ring 1.6s ease-out infinite;
    pointer-events: none;
  }
  .connection-pill.connected .dot { background: var(--ok); box-shadow: 0 0 7px var(--ok); }
  .connection-pill.reconnecting .dot { background: var(--warn); animation: ocrc-pulse 1.2s ease-in-out infinite; }
  .connection-pill.offline .dot { background: transparent; border: 1.5px solid var(--text-4); }
  .connection-state { font-weight: 600; color: var(--text-3); }
  .connection-pill.connected .connection-state { color: var(--ok); }
  .connection-pill.reconnecting .connection-state { color: var(--warn); }
  .connection-pill.offline .connection-state { color: var(--err); }
  .connection-latency { color: var(--text-3); font-size: 10.5px; }

  .install {
    background: var(--accent);
    color: var(--accent-ink);
    border: none;
    border-radius: var(--radius-sm);
    padding: 4px 12px;
    font-size: 0.8em;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
  }

  .user {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .user-email {
    color: var(--text-3);
    font-size: 12px;
  }
  .avatar {
    width: 26px;
    height: 26px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--accent-2);
    color: var(--accent);
    border: 1px solid var(--accent-line);
    font-size: 11px;
    font-weight: 700;
  }

  /* Drawer toggles — desktop hidden, shown on mobile. */
  .iconbtn {
    display: none;
    background: transparent;
    border: none;
    color: var(--text-2);
    font-size: 18px;
    line-height: 1;
    padding: 4px 6px;
    cursor: pointer;
    border-radius: var(--radius-sm);
  }
  .iconbtn:hover { color: var(--text); background: var(--bg-elev); }
  .iconbtn.active { color: var(--accent); background: var(--accent-2); }

  @media (max-width: 820px) {
    .palette-trigger, .user-email { display: none; }
    .new-label { display: none; }
    .iconbtn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 40px;
      min-height: 40px;
      font-size: 20px;
    }
  }
</style>
