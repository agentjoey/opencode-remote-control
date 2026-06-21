<!-- src/lib/components/MobileFab.svelte — v2 mobile speed-dial FAB (≤820px).
     Bottom-right "+" expands to quick actions; the + rotates 45° and a scrim dims. -->
<script lang="ts">
  import { newSessionOpen } from '$lib/stores/ui.js'
  import { paletteOpen } from '$lib/stores/palette.js'

  export let onInspector: () => void = () => {}

  let open = false
  const toggle = () => (open = !open)
  const close = () => (open = false)

  type Action = { label: string; icon: string; run: () => void }
  $: actions = [
    { label: 'New session', icon: '＋', run: () => newSessionOpen.set(true) },
    { label: 'Search & commands', icon: '⌕', run: () => paletteOpen.set(true) },
    { label: 'Inspector', icon: 'ⓘ', run: onInspector },
  ] as Action[]

  function pick(a: Action) { a.run(); close() }
</script>

<div class="fab-root" class:open>
  {#if open}<button class="scrim" aria-label="Close" on:click={close}></button>{/if}

  {#if open}
    <div class="dial" role="menu">
      {#each actions as a (a.label)}
        <button class="dial-item" role="menuitem" on:click={() => pick(a)}>
          <span class="dial-label mono">{a.label}</span>
          <span class="dial-icon" aria-hidden="true">{a.icon}</span>
        </button>
      {/each}
    </div>
  {/if}

  <button class="fab" class:rot={open} aria-label={open ? 'Close menu' : 'Quick actions'} aria-expanded={open} on:click={toggle}>
    <span aria-hidden="true">＋</span>
  </button>
</div>

<style>
  /* Mobile only — the desktop layout has the titlebar "+" menu. */
  .fab-root { display: none; }
  @media (max-width: 820px) {
    .fab-root { display: block; }
  }

  .scrim {
    position: fixed; inset: 0; z-index: 40;
    background: rgba(8, 7, 6, .5); border: none; padding: 0; cursor: default;
    animation: fade .16s ease;
  }
  @keyframes fade { from { opacity: 0; } to { opacity: 1; } }

  .fab {
    position: fixed; z-index: 42;
    right: 18px; bottom: calc(76px + env(safe-area-inset-bottom));
    width: 56px; height: 56px; border-radius: 50%;
    display: grid; place-items: center;
    background: var(--accent); color: var(--accent-ink);
    border: none; font-size: 28px; line-height: 1; cursor: pointer;
    box-shadow: 0 8px 24px rgba(0, 0, 0, .4);
    transition: transform .2s ease;
  }
  .fab.rot { transform: rotate(45deg); }
  .fab:active { transform: scale(.94); }
  .fab.rot:active { transform: rotate(45deg) scale(.94); }

  .dial {
    position: fixed; z-index: 42;
    right: 20px; bottom: calc(146px + env(safe-area-inset-bottom));
    display: flex; flex-direction: column; align-items: flex-end; gap: 12px;
  }
  .dial-item {
    display: flex; align-items: center; gap: 10px;
    background: transparent; border: none; padding: 0; cursor: pointer;
    animation: rise .16s ease both;
  }
  @keyframes rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  .dial-label {
    font-size: 12px; color: var(--text);
    background: var(--bg-elev); border: 1px solid var(--border);
    padding: 6px 10px; border-radius: 8px; white-space: nowrap;
    box-shadow: 0 4px 14px rgba(0, 0, 0, .3);
  }
  .dial-icon {
    width: 44px; height: 44px; border-radius: 50%;
    display: grid; place-items: center; font-size: 18px;
    background: var(--bg-elev2); color: var(--text); border: 1px solid var(--border);
  }
</style>
