<script lang="ts">
  import type { ToolCall } from '../api/types.js'
  import { ansiToHtml } from '../ansi.js'

  export let tools: ToolCall[]
  const LIMIT = 12
  const LINE_CAP = 20
  let expanded = false
  let expandedOutputs: Record<number, boolean> = {}

  $: shown = expanded ? tools : tools.slice(0, LIMIT)
  $: lastRunning = shown.reduce((acc, t, i) => (t.status === 'running' ? i : acc), -1)

  function glyph(status: string): string {
    if (status === 'done') return '✓'
    if (status === 'error') return '✗'
    return '●'
  }

  function splitLines(s: string): string[] {
    return s.split('\n')
  }

  function renderArgs(args: string, idx: number): { html: string; total: number; capped: boolean } {
    const lines = splitLines(args)
    const total = lines.length
    const capped = total > LINE_CAP && !expandedOutputs[idx]
    const visible = capped ? lines.slice(0, LINE_CAP).join('\n') : args
    return { html: ansiToHtml(visible), total, capped }
  }

  function toggleOutput(idx: number) {
    expandedOutputs[idx] = !expandedOutputs[idx]
    expandedOutputs = expandedOutputs
  }
</script>

{#if tools.length > 0}
  <div class="tools">
    {#each shown as t, i}
      {@const r = t.args ? renderArgs(t.args, i) : null}
      <div class="term {t.status}" class:live={i === lastRunning}>
        <div class="term-header">
          <span class="glyph">{glyph(t.status)}</span>
          <span class="tool-name">{t.tool}</span>
        </div>
        {#if r}
          <div class="term-body">{@html r.html}</div>
          {#if r.capped}
            <button class="toggle" on:click={() => toggleOutput(i)}>
              ▼ show all {r.total} lines
            </button>
          {:else if r.total > LINE_CAP && expandedOutputs[i]}
            <button class="toggle" on:click={() => toggleOutput(i)}>
              ▲ collapse
            </button>
          {/if}
        {/if}
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
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .term {
    background: var(--bg-panel);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }
  .term-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--bg-input);
    border-bottom: 1px solid var(--border);
    font-size: 11px;
  }
  .glyph { flex-shrink: 0; }
  .tool-name { flex-shrink: 0; color: var(--text-2); }

  .term.done .glyph { color: var(--ok); }
  .term.done .tool-name { color: var(--text-3); }
  .term.running .glyph { color: var(--accent); }
  .term.running .tool-name { color: var(--text-2); }
  .term.running.live .glyph { animation: blink 1s ease-in-out infinite; }
  .term.running.live .tool-name { color: var(--text); }
  .term.error .glyph { color: var(--err); }
  .term.error .tool-name { color: var(--err); }

  .term-body {
    padding: 8px 10px;
    white-space: pre-wrap;
    word-break: break-all;
    overflow-x: auto;
    color: var(--text);
    font-size: 12px;
    line-height: 1.5;
    max-height: 600px;
    overflow-y: auto;
  }
  .toggle {
    display: block;
    width: 100%;
    background: var(--bg-input);
    border: none;
    border-top: 1px solid var(--border);
    color: var(--text-3);
    font: inherit;
    font-size: 11px;
    padding: 3px 10px;
    cursor: pointer;
    text-align: left;
  }
  .toggle:hover { color: var(--text-2); }

  @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
  .more {
    background: transparent;
    border: none;
    color: var(--text-3);
    cursor: pointer;
    font: inherit;
    padding: 2px 0;
  }
</style>
