<!-- src/lib/components/CommandPalette.svelte -->
<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { sessionList } from '$lib/stores/sessions.js'
  import { filterSessions } from '$lib/nav/filterSessions.js'
  import { api } from '$lib/api/client.js'
  import { can, currentBackendId, backendName } from '$lib/stores/capabilities.js'

  export let open = false
  let query = ''
  let active = 0
  $: results = filterSessions($sessionList, query)
  $: if (active >= results.length) active = 0

  $: activeSessionId = $page.params.sessionId as string | undefined
  let commands: Array<{ name: string; description: string }> = []
  let loadedForBackend: string | null = null
  let running = ''
  $: filteredCommands = commands.filter((cmd) => {
    const q = query.trim().toLowerCase()
    if (!q) return true
    return cmd.name.toLowerCase().includes(q) || cmd.description.toLowerCase().includes(q)
  })

  $: if (open && $currentBackendId && $currentBackendId !== loadedForBackend) {
    loadedForBackend = $currentBackendId
    if ($can('commands')) {
      api.commands($currentBackendId).then((list) => { commands = list }).catch(() => { loadedForBackend = null })
    } else {
      commands = []
    }
  }

  export function close() { open = false; query = ''; cmdError = '' }
  function choose(id: string) { goto(`/${id}/`); close() }

  let cmdError = ''
  async function runCommand(name: string) {
    if (!activeSessionId || running) return
    running = name
    cmdError = ''
    try {
      await api.runCommand({ sessionId: activeSessionId, command: name })
      close() // reveal the chat — the command's turn streams there now
    } catch (err) {
      cmdError = `/${name} failed: ${(err as Error).message}`
    } finally {
      running = ''
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { close(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, results.length - 1) }
    if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0) }
    if (e.key === 'Enter' && results[active]) { e.preventDefault(); choose(results[active].id) }
  }
</script>

{#if open}
  <div class="overlay">
    <button class="backdrop" aria-label="Close" on:click={close}></button>
    <div class="palette" role="dialog" aria-modal="true" aria-label="Switch session" tabindex="-1">
      <!-- svelte-ignore a11y_autofocus -->
      <input class="q mono" autofocus placeholder="Search sessions or commands…" bind:value={query} on:keydown={onKey} />
      <div class="results">
        {#each results as s, i (s.id)}
          <button class="row" class:active={i === active} on:click={() => choose(s.id)}>
            <span>{s.title ?? s.id.slice(-8)}</span>
            <span class="label">{s.agent ?? ''}</span>
          </button>
        {/each}
        {#if results.length === 0}<div class="empty label">No sessions</div>{/if}

        {#if $can('commands') && filteredCommands.length > 0}
          <div class="group-label label">{$backendName} commands</div>
          {#each filteredCommands as cmd (cmd.name)}
            <button
              class="row"
              disabled={!activeSessionId || running === cmd.name}
              title={!activeSessionId ? 'Open a session first' : ''}
              on:click={() => runCommand(cmd.name)}
            >
              <span>/{cmd.name}</span>
              <span class="label">{running === cmd.name ? 'running…' : cmd.description}</span>
            </button>
          {/each}
          {#if !activeSessionId}<div class="empty label">Open a session to run commands</div>{/if}
          {#if cmdError}<div class="empty" style="color: var(--err)">{cmdError}</div>{/if}
        {/if}
      </div>
    </div>
  </div>
{/if}


<style>
  .overlay { position: fixed; inset: 0; display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; z-index: 200; }
  .backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.55); border: none; padding: 0; margin: 0; cursor: default; }
  .palette { position: relative; z-index: 1; width: 480px; max-width: 90vw; background: var(--bg-elev); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; box-shadow: 0 16px 50px rgba(0,0,0,.6); }
  .q { width: 100%; box-sizing: border-box; background: transparent; border: none; border-bottom: 1px solid var(--border); color: var(--text); padding: 12px 14px; font-size: 14px; outline: none; }
  .results { max-height: 300px; overflow: auto; padding: 6px; }
  .row { display: flex; justify-content: space-between; width: 100%; background: transparent; border: none; color: var(--text); padding: 8px 10px; border-radius: var(--radius-sm); cursor: pointer; }
  .row.active, .row:hover { background: var(--accent-2); }
  .row:disabled { opacity: .5; cursor: default; }
  .group-label { padding: 8px 10px 4px; text-transform: uppercase; font-size: 0.7em; letter-spacing: .06em; }
  .empty { padding: 12px; }
</style>
