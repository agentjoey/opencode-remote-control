<script lang="ts">
  import { onMount } from 'svelte'
  import { getBotUrl } from '../lib/adapters/extension.js'
  import { setBaseUrl } from '../lib/api/client.js'
  import { createWsClient } from '../lib/ws/client.js'
  import { connection } from '../lib/stores/connection.js'
  import { sessionList } from '../lib/stores/sessions.js'
  import { activeSession } from '../lib/stores/activeSession.js'
  import SessionList from '../lib/components/SessionList.svelte'
  import Card from '../lib/components/Card.svelte'
  import Composer from '../lib/components/Composer.svelte'
  import ConnectionBadge from '../lib/components/ConnectionBadge.svelte'

  let scrollEl: HTMLDivElement
  let botUrl = ''
  let configured = false
  let error = ''

  onMount(async () => {
    try {
      botUrl = await getBotUrl()
      setBaseUrl(botUrl)
      configured = true
      createWsClient({ url: `${botUrl.replace(/^http/, 'ws')}/ws`, onMessage: (msg) => {
        if (msg.type === 'hello') {
          // Handle initial session list
        } else if (msg.type === 'card') {
          // Handle card - this would update stores
        }
      }})
    } catch (err) {
      error = String(err)
    }

    // Listen for injected prompts from context menu
    const listener = (msg: any) => {
      if (msg?.type === 'inject-prompt') {
        // Pre-fill composer (handled via store or event)
        window.dispatchEvent(new CustomEvent('oprc-inject-prompt', { detail: msg.payload }))
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  })

  $: currentCards = $activeSession ? ($sessionList[$activeSession] ?? []) : []

  function onSend(text: string) {
    if (!$activeSession) return
    fetch(`${botUrl}/api/message`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ sessionId: $activeSession, text }),
    }).catch(console.error)
  }

  $: if (scrollEl && currentCards.length) {
    setTimeout(() => { scrollEl.scrollTop = scrollEl.scrollHeight }, 50)
  }
</script>

{#if !configured}
  <div class="unconfigured">
    {#if error}
      <h2>Extension not configured</h2>
      <p>Open the extension popup and set your bot URL.</p>
      <p class="err">{error}</p>
    {:else}
      <p>Loading...</p>
    {/if}
  </div>
{:else}
  <div class="app">
    <header>
      <span class="logo">oprc</span>
      <ConnectionBadge status={$connection} />
    </header>
    <div class="body">
      <aside>
        <SessionList />
      </aside>
      <main>
        <div class="cards" bind:this={scrollEl}>
          {#each currentCards as card (card.kind + (card as any).sessionId + (card as any).ts)}
            <Card {card} />
          {/each}
        </div>
        <Composer on:send={(e) => onSend(e.detail)} />
      </main>
    </div>
  </div>
{/if}

<style>
  .unconfigured { padding: 2rem; color: #fff; font-family: sans-serif; }
  .unconfigured h2 { margin: 0 0 0.5rem; font-size: 1.25rem; }
  .unconfigured .err { color: #ef4444; font-size: 0.875rem; }
  .app { display: flex; flex-direction: column; height: 100vh; background: #0a0a0a; color: #e5e5e5; font-family: sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 0.5rem 1rem; border-bottom: 1px solid #222; }
  .logo { font-weight: 700; letter-spacing: -0.02em; }
  .body { display: flex; flex: 1; overflow: hidden; }
  aside { width: 220px; border-right: 1px solid #222; overflow-y: auto; }
  main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
  .cards { flex: 1; overflow-y: auto; padding: 1rem; }
</style>
