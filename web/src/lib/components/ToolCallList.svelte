<script lang="ts">
  import type { ToolCall } from '../api/types.js'

  export let tools: ToolCall[]
  const LIMIT = 12
  let expanded = false

  $: shown = expanded ? tools : tools.slice(0, LIMIT)
  // Commands run sequentially, so only the *last* still-running tool is truly
  // "in progress" — earlier ones may just not be marked done yet during a
  // stream. Blink only that one; the rest stay static.
  $: lastRunning = shown.reduce((acc, t, i) => (t.status === 'running' ? i : acc), -1)

  function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function formatArgs(args: string): string {
    try {
      const obj = JSON.parse(args) as Record<string, unknown>
      if (obj.filePath && typeof obj.filePath === 'string') {
        const fp = escapeHtml(obj.filePath)
        obj.filePath = `__FP__${fp}__FP__`
        const json = JSON.stringify(obj)
        return escapeHtml(json).replace(
          /__FP__(.+?)__FP__/g,
          '<span class="fp">$1</span>'
        )
      }
    } catch {}
    return escapeHtml(args)
  }
</script>

{#if tools.length > 0}
  <div class="tools">
    {#each shown as t, i}
      <div class="t {t.status}" class:live={i === lastRunning}>
        <span class="dot"></span>
        <span class="name">{t.tool}</span>
        {#if t.args}<span class="args">{@html formatArgs(t.args)}</span>{/if}
      </div>
    {/each}
    {#if tools.length > LIMIT && !expanded}
      <button class="more" on:click={() => (expanded = true)}>… {tools.length - LIMIT} more</button>
    {/if}
  </div>
{/if}

<style>
  .tools {
    font-family: var(--font-mono);
    font-size: 12px;
    margin: 2px 0 6px;
  }
  .t {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .name { flex-shrink: 0; }
  .args { color: var(--text-3); overflow: hidden; text-overflow: ellipsis; }
  .args :global(.fp) { color: var(--hl-green); }

  /* running (not the active one): static emerald dot, neutral text */
  .t.running .dot { background: var(--accent); }
  .t.running .name { color: var(--text-2); }
  /* the single active command: pulsing dot + glow + bright text */
  .t.running.live .dot { box-shadow: 0 0 6px var(--accent); animation: blink 1s ease-in-out infinite; }
  .t.running.live .name { color: var(--text); }
  /* done: solid muted-green dot, muted text */
  .t.done .dot { background: var(--ok); }
  .t.done .name { color: var(--text-3); }
  /* error: solid red dot + red text */
  .t.error .dot { background: var(--err); }
  .t.error .name { color: var(--err); }
  /* pending / unknown: hollow ring */
  .t .dot { border: 1.5px solid var(--text-3); }
  .t.running .dot, .t.done .dot, .t.error .dot { border: none; }

  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  .more { background: transparent; border: none; color: var(--text-3); cursor: pointer; font: inherit; padding: 2px 0; }
</style>
