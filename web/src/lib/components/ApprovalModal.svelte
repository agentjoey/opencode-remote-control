<script lang="ts">
  import type { StructuredCard } from '../api/types.js'
  import { api } from '../api/client.js'

  export let card: Extract<StructuredCard, { kind: 'approval' }>
  export let onClose: () => void

  async function decide(decision: 'once' | 'always' | 'reject') {
    await api.approve(card.sessionId, card.requestId, decision)
    onClose()
  }
</script>

<div class="overlay" on:click={onClose}>
  <div class="modal" on:click|stopPropagation>
    <div class="title">{card.title}</div>
    <pre class="args">{JSON.stringify(card.args, null, 2)}</pre>
    <div class="actions">
      <button class="primary" on:click={() => decide('once')}>Allow once</button>
      <button on:click={() => decide('always')}>Always allow</button>
      <button class="reject" on:click={() => decide('reject')}>Reject</button>
    </div>
  </div>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }
  .modal {
    background: #1a1a1a;
    border: 1px solid #333;
    border-radius: 12px;
    padding: 20px;
    max-width: 480px;
    width: 90%;
  }
  .title {
    font-weight: 600;
    margin-bottom: 10px;
  }
  .args {
    background: #111;
    border-radius: 8px;
    padding: 10px;
    font-size: 0.85em;
    overflow-x: auto;
    margin-bottom: 14px;
  }
  .actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  button {
    flex: 1;
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid #444;
    background: #222;
    color: #ccc;
    cursor: pointer;
  }
  button.primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
  }
  button.reject {
    background: #7f1d1d;
    border-color: #991b1b;
    color: #fca5a5;
  }
</style>
