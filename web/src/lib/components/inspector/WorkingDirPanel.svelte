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
    if (!id) {
      dir = ''
      files = []
      expanded.clear()
      expanded = expanded
      return
    }
    try {
      // The working dir comes from context (every backend has it); the diff file
      // list only when the backend supports it.
      const ctx = await api.context(id)
      dir = (ctx as any)?.directory ?? ''
      if (showDiff) {
        const diff = await api.diff(id)
        files = (Array.isArray(diff) ? diff : [])
          .map((d: any) => ({
            path: String(d?.path ?? ''),
            additions: Number(d?.additions ?? 0),
            deletions: Number(d?.deletions ?? 0),
            lines: Array.isArray(d?.lines) ? d.lines : [],
          }))
          .filter((d) => d.path)
          .slice(0, 8)
      } else {
        files = []
      }
    } catch {
      /* keep last valid state on transient failures */
    }
  }

  $: load(sessionId), tick, showDiff

  $: totalAdds = files.reduce((a, f) => a + f.additions, 0)
  $: totalDels = files.reduce((a, f) => a + f.deletions, 0)

  function repoName(d?: string) {
    if (!d) return ''
    const parts = d.replace(/\/+$/, '').split('/')
    return parts[parts.length - 1] || ''
  }

  function short(p: string) {
    const parts = p.split('/')
    return parts.length > 3 ? '…/' + parts.slice(-3).join('/') : p
  }

  function changeKind(entry: DiffEntry): 'add' | 'del' | 'mod' | 'none' {
    if (entry.additions > 0 && entry.deletions > 0) return 'mod'
    if (entry.additions > 0) return 'add'
    if (entry.deletions > 0) return 'del'
    return 'none'
  }

  function changeColor(kind: ReturnType<typeof changeKind>) {
    if (kind === 'add') return 'var(--ok)'
    if (kind === 'del') return 'var(--err)'
    if (kind === 'mod') return 'var(--warn)'
    return 'var(--text-4)'
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
  <div class="hd">
    <span class="section-label">Working dir</span>
    {#if files.length}<span class="counts mono">+{totalAdds}/−{totalDels}</span>{/if}
  </div>
  {#if repoName(dir)}
    <div class="repo-line mono">{repoName(dir)}</div>
  {/if}
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
            <span class="change" style="background: {changeColor(changeKind(entry))}"></span>
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
  {#if !dir && files.length === 0}<div class="section-label">—</div>{/if}
</div>

<style>
  .wd { display: flex; flex-direction: column; gap: 8px; }
  .hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .section-label {
    text-transform: uppercase;
    letter-spacing: .16em;
    color: var(--text-3);
    font-size: 10px;
  }
  .counts {
    color: var(--text-2);
    font-size: 11px;
  }
  .counts :global(*) {
    color: inherit;
  }
  .repo-line {
    color: var(--text-2);
    font-size: 11px;
  }
  .files {
    color: var(--text-2);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .entry {
    display: flex;
    flex-direction: column;
    background: var(--bg-elev);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .f {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    margin: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
  }
  .f:hover { background: var(--bg-elev2); }
  .f:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; border-radius: 3px; }

  .change {
    width: 8px;
    height: 8px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    direction: rtl;
    text-align: left;
    font-size: 11px;
  }
  .cnt {
    margin-left: auto;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .cnt .add { color: var(--ok); }
  .cnt .del { color: var(--err); }
  .cnt .sep { color: var(--text-3); }

  .diff {
    margin: 2px 6px 6px;
    padding: 4px 6px;
    background: var(--bg);
    border: 1px solid var(--border-2);
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
