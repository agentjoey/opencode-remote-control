<script lang="ts">
  import { plusMenuOpen, newSessionOpen } from '$lib/stores/ui.js'
  import { paletteOpen } from '$lib/stores/palette.js'

  export let anchor: HTMLElement | null = null

  function openNewSession() {
    plusMenuOpen.set(false)
    newSessionOpen.set(true)
  }

  function openPalette() {
    plusMenuOpen.set(false)
    paletteOpen.set(true)
  }

  function close() {
    plusMenuOpen.set(false)
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') close()
  }
</script>

<svelte:window on:keydown={onKey} />

{#if $plusMenuOpen}
  <div class="overlay">
    <button class="backdrop" aria-label="Close" on:click={close}></button>
    <div
      class="menu"
      role="menu"
      aria-label="New actions"
      style={anchor ? `top:${anchor.getBoundingClientRect().bottom + 6}px; left:${anchor.getBoundingClientRect().left}px` : ''}
    >
      <button class="item" role="menuitem" on:click={openNewSession}>
        <span class="icon" aria-hidden="true">+</span>
        <span class="label">New session</span>
      </button>
      <button class="item" role="menuitem" on:click={openPalette}>
        <span class="icon" aria-hidden="true">⌕</span>
        <span class="label">Command palette</span>
        <kbd class="keycap mono">⌘K</kbd>
      </button>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 250;
    pointer-events: none;
  }
  .backdrop {
    position: absolute;
    inset: 0;
    background: transparent;
    border: none;
    padding: 0;
    margin: 0;
    cursor: default;
    pointer-events: auto;
  }
  .menu {
    position: absolute;
    z-index: 1;
    min-width: 180px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    box-shadow: 0 18px 50px rgba(0,0,0,.55);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    pointer-events: auto;
    animation: ocrc-pop .14s ease;
  }
  @keyframes ocrc-pop {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: background .12s ease;
  }
  .item:hover { background: var(--accent-2); }
  .icon {
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    background: var(--bg-panel);
    border: 1px solid var(--border-2);
    color: var(--text-2);
    font-size: 12px;
    flex-shrink: 0;
  }
  .label {
    flex: 1;
    font-size: 13px;
    font-weight: 500;
  }
  .keycap {
    flex-shrink: 0;
    font-size: 10px;
    color: var(--text-3);
    text-transform: uppercase;
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 2px 5px;
  }

  @media (max-width: 820px) {
    .overlay {
      display: flex;
      align-items: flex-end;
      justify-content: center;
      padding: 0 0 env(safe-area-inset-bottom, 0);
      pointer-events: auto;
      background: rgba(8, 7, 6, .45);
    }
    /* backdrop stays tappable to dismiss the sheet (no Esc on touch). */
    .menu {
      position: relative;
      top: auto !important;   /* ignore the desktop anchor coords */
      left: auto !important;
      width: 100%;
      max-width: 100%;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      animation: sheetin .18s ease;
    }
    @keyframes sheetin {
      from { opacity: 0; transform: translateY(40px); }
      to { opacity: 1; transform: translateY(0); }
    }
  }
</style>
