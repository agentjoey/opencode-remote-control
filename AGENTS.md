<!-- pact:begin (managed by pactify — edit outside this block) -->
# pact protocol — seat `opencode`

This repo uses the **pact protocol** (v1). You are seat `opencode`, roles: worker.

**Primary — MCP:** the `pact` MCP server is wired into your config. Use its tools
(status / join / assign / checkpoint / accept / changes / merge / list) and resources
(`pact://state`, `pact://log`). Cold start: call `status`, then `join`
(registers your seat and checks out your feature branch).

**Fallback — shell** (if MCP is unavailable):
```bash
export PACT_AGENT_ID=opencode
pactify join opencode --roles worker
```
then `pactify help` for the verbs.

**The two rules:** a worker cannot self-accept (only the task's reviewer accepts); a
feature cannot merge until all its tasks are accepted.
<!-- pact:end -->
