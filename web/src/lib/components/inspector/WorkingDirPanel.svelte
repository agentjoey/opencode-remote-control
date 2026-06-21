<!-- src/lib/components/inspector/WorkingDirPanel.svelte -->
<script lang="ts">
  import { api } from '$lib/api/client.js'

  interface DiffLine { kind: 'add' | 'del' | 'ctx'; text: string }
  interface DiffEntry { path: string; additions: number; deletions: number; lines: DiffLine[] }

  export let sessionId: string | undefined = undefined
  export let tick = 0
  /** Whether the backend produces a diff (kimi/ACP don't — show only the dir). */
  export let showDiff = true

  let dir = ''
  let files: DiffEntry[] = []
  let expanded = new Set<string>()

  async function load(id?: string) {
    if (!id) { dir = ''; files = []; expanded.clear(); expanded = expanded; return }
    try {
      // The working dir comes from context (every backend has it); the diff file
      // list only when the backend supports it.
      const ctx = await api.context(id)
      dir = (ctx as any)?.directory ?? ''
      if (showDiff) {
        const diff = await api.diff(id)
        files = (Array.isArray(diff) ? diff : []).map((d: any) => ({
          path: String(d?.path ?? ''),
          additions: Number(d?.additions ?? 0),
          deletions: Number(d?.deletions ?? 0),
          lines: Array.isArray(d?.lines) ? d.lines : [],
        })).filter((d) => d.path).slice(0, 8)
      } else {
        files = []
      }
    } catch { /* keep */ }
  }

  $: load(sessionId), tick, showDiff

  function short(p: string) {
    const parts = p.split('/')
    return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p
  }

  function counts(entry: DiffEntry) {
    return `+${entry.additions} / −${entry.deletions}`
  }

  function toggle(path: string) {
    if (expanded.has(path)) expanded.delete(path)
    else expanded.add(path)
    expanded = expanded
  }

  function linePrefix(kind: DiffLine['kind']) {
    if (kind === 'add') return '+'
    if (kind === 'del') return '−'
    return ' '
  }

  function lineBody(line: DiffLine) {
    // DiffEntry.text is not supposed to include the sign, but real-world payloads
    // (and some test fixtures) may. Avoid doubled prefixes when that happens.
    if (line.kind === 'add' && line.text.startsWith('+')) return line.text.slice(1)
    if (line.kind === 'del' && line.text.startsWith('-')) return line.text.slice(1)
    if (line.kind === 'ctx' && line.text.startsWith(' ')) return line.text.slice(1)
    return line.text
  }
</script>

<div class="wd">
  <div class="label">Working dir</div>
  {#if dir}<div class="path mono">{short(dir)}</div>{/if}
  {#if files.length}
    <div class="files mono">
      {#each files as entry (entry.path)}
        <div class="entry">
          <button
            type="button"
            class="f"
            class:open={expanded.has(entry.path)}
            aria-expanded={expanded.has(entry.path)}
            on:click={() => toggle(entry.path)}
          >
            <span class="m">M</span>
            <span class="nm">{short(entry.path)}</span>
            <span class="cnt">
              <span class="add">+{entry.additions}</span>
              <span class="sep">/</span>
              <span class="del">−{entry.deletions}</span>
            </span>
          </button>
          {#if expanded.has(entry.path) && entry.lines.length > 0}
            <div class="diff">
              {#each entry.lines as line}
                <div class="line {line.kind}">
                  <span class="pre">{linePrefix(line.kind)}</span>{lineBody(line)}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
  {#if !dir && files.length === 0}<div class="label">—</div>{/if}
</div>

<style>
  .wd { font-size: 11px; }
  .path { color: var(--text-2); margin: 4px 0 6px; }
  .files { color: var(--text-2); display: flex; flex-direction: column; gap: 3px; }

  .entry { display: flex; flex-direction: column; }

  .f {
    display: flex;
    align-items: center;
    gap: 7px;
    width: 100%;
    padding: 0;
    margin: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
    cursor: pointer;
  }
  .f:hover { color: var(--text); }
  .f:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; border-radius: 3px; }

  .m { color: var(--warn); flex-shrink: 0; font-weight: 600; }
  .nm { overflow: hidden; text-overflow: ellipsis; }
  .cnt { margin-left: auto; flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; }
  .cnt .add { color: var(--ok); }
  .cnt .del { color: var(--err); }
  .cnt .sep { color: var(--text-3); }

  .diff {
    margin: 2px 0 6px 18px;
    padding: 4px 6px;
    background: var(--bg-elev);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow-x: auto;
  }
  .line {
    font-family: var(--font-mono);
    white-space: pre;
    line-height: 1.45;
  }
  .line .pre { user-select: none; }
  .line.add { color: var(--ok); }
  .line.del { color: var(--err); }
  .line.ctx { color: var(--text-3); }
</style>
