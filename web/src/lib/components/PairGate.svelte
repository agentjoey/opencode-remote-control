<!-- src/lib/components/PairGate.svelte -->
<!--
  Shown when the app has no (valid) token. On iOS a home-screen PWA gets its own
  storage container (not shared with Safari) and is launched at the manifest
  start_url ("/", no token), so the token can't ride in via the URL — the user
  pairs *inside* the installed app by pasting the token/link from /pair.
-->
<script lang="ts">
  import { setToken } from '../auth-token.js'
  let input = ''
  let err = ''

  // Accept a raw token, a "?token=…" / "#token=…" string, or a full pairing URL.
  function parseToken(s: string): string {
    const t = s.trim()
    const m = t.match(/token=([^&#\s]+)/)
    return m ? decodeURIComponent(m[1]) : t
  }

  function connect() {
    const token = parseToken(input)
    if (!token || token.length < 16) { err = 'That doesn’t look like a valid token.'; return }
    setToken(token)
    // Reload so the app re-initializes (API + WS) with the stored token.
    location.reload()
  }
</script>

<div class="gate">
  <div class="card">
    <div class="brand"><b>pactify</b> <span class="linx">linx</span></div>
    <h1>Pair this device</h1>
    <p>
      In Telegram, send <code>/pair</code> to your bot, then paste the
      <strong>token</strong> (or the whole link) below.
    </p>
    <input
      class="field mono"
      bind:value={input}
      placeholder="Paste pairing token or link…"
      autocapitalize="off" autocorrect="off" spellcheck="false"
      on:keydown={(e) => e.key === 'Enter' && connect()}
    />
    {#if err}<div class="err">{err}</div>{/if}
    <button class="connect" on:click={connect} disabled={!input.trim()}>Connect</button>
    <p class="hint">The token is stored only on this device.</p>
  </div>
</div>

<style>
  .gate {
    position: fixed; inset: 0; z-index: 500;
    display: flex; align-items: center; justify-content: center;
    background: var(--bg);
    padding: 24px;
    padding-top: calc(24px + env(safe-area-inset-top, 0px));
    padding-bottom: calc(24px + env(safe-area-inset-bottom, 0px));
  }
  .card {
    width: 100%; max-width: 360px;
    display: flex; flex-direction: column; gap: 14px;
  }
  .brand { font-weight: 800; color: var(--accent); letter-spacing: .1em; font-size: 15px; }
  h1 { margin: 0; font-size: 20px; color: var(--text); font-weight: 700; }
  p { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-2); }
  code { background: var(--bg-elev); padding: 1px 6px; border-radius: var(--radius-sm); color: var(--accent); font-size: 0.92em; }
  .field {
    width: 100%; box-sizing: border-box;
    background: var(--bg-input); border: 1px solid var(--border);
    border-radius: var(--radius-sm); color: var(--text);
    padding: 12px 14px; font-size: 16px; outline: none;
  }
  .field:focus { border-color: var(--accent); }
  .err { color: var(--err); font-size: 12px; }
  .connect {
    background: var(--accent); color: var(--accent-ink);
    border: none; border-radius: var(--radius-sm);
    padding: 12px; font-size: 15px; font-weight: 600; cursor: pointer;
  }
  .connect:disabled { opacity: .5; cursor: default; }
  .hint { font-size: 11px; color: var(--text-3); }
</style>
