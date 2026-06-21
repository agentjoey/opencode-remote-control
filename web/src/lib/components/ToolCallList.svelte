<script lang="ts">
  import type { ToolCall } from '../api/types.js'
  import { ansiToHtml } from '../ansi.js'

  interface ToolCallExtra extends ToolCall {
    adds?: number
    dels?: number
    dur?: number
    detail?: string
    output?: string
  }

  export let tools: ToolCall[]
  const LIMIT = 12
  let expanded = false
  let expandedDetails: Record<number, boolean> = {}

  $: typed = tools as ToolCallExtra[]
  $: shown = expanded ? typed : typed.slice(0, LIMIT)
  $: total = typed.length
  $: done = typed.filter((t) => t.status === 'done').length

  function detailOf(t: ToolCallExtra): string | undefined {
    return t.detail || t.output || undefined
  }

  function hasDetail(t: ToolCallExtra): boolean {
    return !!detailOf(t)
  }

  function fmtDur(s?: number): string {
    if (s == null) return ''
    if (s < 1) return `${(s * 1000).toFixed(0)}ms`
    return `${s.toFixed(1)}s`
  }

  function toggleDetail(i: number) {
    expandedDetails[i] = !expandedDetails[i]
    expandedDetails = expandedDetails
  }
</script>

{#if tools.length > 0}
  <div class="execution">
    <div class="header">
      <span class="label mono">EXECUTION</span>
      <span class="rule" aria-hidden="true"></span>
      <span class="count mono">{done}/{total} steps</span>
    </div>
    <div class="rows">
      {#each shown as t, i}
        {@const detail = detailOf(t)}
        <div class="row {t.status}">
          <button class="row-main" class:expandable={hasDetail(t)} on:click={() => hasDetail(t) && toggleDetail(i)}>
            <span class="status" aria-hidden="true"></span>
            <span class="name mono">{t.tool}</span>
            <span class="arg mono">{t.args}</span>
            {#if t.adds || t.dels}
              <span class="diff mono">
                {#if t.adds}<span class="add">+{t.adds}</span>{/if}
                {#if t.dels}<span class="del">−{t.dels}</span>{/if}
              </span>
            {/if}
            {#if t.status === 'running'}
              <span class="shimmer" aria-hidden="true"></span>
            {:else if t.dur != null}
              <span class="dur mono">{fmtDur(t.dur)}</span>
            {/if}
            {#if hasDetail(t)}
              <span class="caret" class:open={expandedDetails[i]} aria-hidden="true">▸</span>
            {/if}
          </button>
          {#if detail && expandedDetails[i]}
            <div class="detail mono">
              {@html ansiToHtml(detail)}
            </div>
          {/if}
        </div>
      {/each}
      {#if typed.length > LIMIT && !expanded}
        <button class="more mono" on:click={() => (expanded = true)}>
          … {typed.length - LIMIT} more
        </button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .execution {
    background: var(--bg-elev);
    border: 1px solid var(--border-2);
    border-radius: 11px;
    padding: 10px 12px 12px;
    margin: 0 0 12px;
  }
  .header {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }
  .label {
    font-size: 9px;
    color: var(--text-4);
    letter-spacing: .12em;
    text-transform: uppercase;
  }
  .rule {
    flex: 1;
    height: 1px;
    background: var(--border-2);
  }
  .count {
    font-size: 10px;
    color: var(--text-3);
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .row-main {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: 7px;
    color: inherit;
    text-align: left;
    cursor: default;
    transition: background .12s ease;
  }
  .row-main.expandable { cursor: pointer; }
  .row-main.expandable:hover { background: rgba(255,255,255,.03); }

  .status {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    border: 1.5px solid transparent;
    flex-shrink: 0;
    box-sizing: border-box;
  }
  .row.running .status {
    background: var(--accent);
    border-color: var(--accent);
    box-shadow: 0 0 7px var(--accent);
    animation: ocrc-blink 1s step-end infinite;
  }
  .row.done .status { background: var(--ok); border-color: var(--ok); }
  .row.error .status { background: var(--err); border-color: var(--err); }
  .row:not(.running):not(.done):not(.error) .status {
    background: transparent;
    border: 1.5px solid var(--text-4);
  }

  .name {
    flex-shrink: 0;
    font-size: 12.5px;
    font-weight: 500;
  }
  .row.done .name { color: var(--text-2); }
  .row.running .name { color: var(--text); }
  .row.error .name { color: var(--err); }
  .row:not(.running):not(.done):not(.error) .name { color: var(--text-2); }

  .arg {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: var(--hl-green);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .diff {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11.5px;
  }
  .diff .add { color: var(--ok); }
  .diff .del { color: var(--err); }

  .shimmer {
    flex-shrink: 0;
    width: 42px;
    height: 4px;
    border-radius: 2px;
    background: linear-gradient(90deg, var(--accent) 0%, var(--text) 50%, var(--accent) 100%);
    background-size: 200% 100%;
    animation: ocrc-shimmer 1.4s linear infinite;
  }
  .dur {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-4);
  }

  .caret {
    flex-shrink: 0;
    font-size: 11px;
    color: var(--text-3);
    transition: transform .2s ease;
  }
  .caret.open { transform: rotate(90deg); }

  .detail {
    margin: 4px 0 2px 23px;
    padding: 8px 10px;
    background: var(--bg);
    border: 1px solid var(--border-2);
    border-radius: 8px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .detail :global(pre) {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .more {
    align-self: flex-start;
    background: transparent;
    border: none;
    color: var(--text-3);
    font-size: 11.5px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .more:hover { color: var(--text); }
</style>
