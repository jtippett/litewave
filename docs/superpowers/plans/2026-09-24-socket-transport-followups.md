# Socket transport follow-ups (deferred to plans 2 and 3)

Collected from the task and whole-branch reviews of the socket-transport branch (2026-09-24). Each line is a reviewer finding the controller deferred, or a ruling that changed the plan.

## Deferred findings

- Task 1: minor (deferred): litewave.ex moduledoc still shows project_id as required
- Task 1: minor (deferred): from_registration/2 wrong-project_id branch has no direct test
- Task 1: minor (deferred): registration fixture test computes key with the same function it validates (tautological)
- Task 2: minor (deferred): socket/1 silently falls back to Path.expand when canonicalisation fails (plan-mandated); no test for fallback or prod rejection via socket/1
- Task 3: minor (deferred): probe/remove/bind not atomic across two simultaneous BEAMs; cleanup does not verify descriptor ownership before deleting
- Task 3: minor (deferred): SIGKILL leaves socket/descriptor/.partial; .partial files never swept
- Task 3: minor (deferred): listener never retries after Bandit exit (document)
- Task 3: minor (deferred): descriptor project_id uses config.project_id not paths.key (identical for socket config since :project_id is not an env option)
- Task 3: minor (deferred): info/1 may return socket: nil on rescue path
- Task 3: minor (deferred): socket_plug 404 bypasses Handler.respond (no cache-control)
- Task 3: minor (deferred): test gaps — descriptor dir mode, first socket survives second listener stop, Bandit EXIT clause
- Task 3: minor (deferred): abort_start/2 calls Supervisor.stop unguarded; :noproc race could exit init (wrap in catch :exit)
- Task 4: minor (deferred): detect/0 scans all loaded modules per health request (spec-mandated lazy; fast-fail on **sockets** check)
- Task 4: minor (deferred): Application.children/1 public for testability
- Task 5: minor (deferred, pre-existing): relative LITEWAVE_HOME resolves against cwd in Node (path.resolve) but stays relative in Elixir; docs already say "short absolute directory" — consider Path.expand in Elixir or documenting absolute-only
- Task 6: minor (deferred): connect-phase timeout message says "refused"
- Task 6: minor (deferred): symlinked runtime.json reported runtime_unavailable not permission_denied; no test for symlink/0644 descriptor
- Task 6: minor (deferred): pre-existing phoenix.json with UUID project_id is stranded (no users yet; pre-release)
- Task 6: minor (deferred): stale descriptor always wins over configured phoenix.json fallback (brief-mandated; spec 5.1 order)
- Task 6: minor (deferred): realpath ENOENT escapes resolveRuntime raw; generic message dropped "token permissions"
- Task 6: minor (deferred): test setup before try leaks LITEWAVE_HOME/temp root on early throw
- Task 7: minor (deferred): not_registered messages (mcp.ts, storage.ts) still say "--app URL" as if required
- Task 7: minor (deferred): browser tool description does not restate how to register
- Task 8: minor (deferred): vestigial registration.id "http-fixture" literal in the bridge script
- Task 9: minor (deferred, for plan 2): README lost the note that LITEWAVE_HOME must match between the app and all Litewave clients
- Final re-review: all_loaded-count test may flake under background code loading; tighten to a MapSet diff over registered-name modules
- Final re-review: HTTP fallback failure after a refused socket reports the socket-specific message; worst-case health latency doubles
- Final re-review: a symlinked ~/.litewave now disables the listener (private_dir requires a real directory); document or allow
- Final re-review: a leading ~ in LITEWAVE_HOME expands on the Elixir side only
- Final re-review: app-env allow_eval/allow_sql now also apply to a hand-written Plug that omits them; document (generated snippet passes false explicitly)
- Final review: README should tell hosts to set enabled: false in config/test.exs; restore the read-write SQL warning beside allow_eval/allow_sql; note that phoenix setup needs init; unify transport names (Node "http" vs Elixir :endpoint)
- Final review: SECURITY.md and root README still describe token and registration-ID identity for runtime access
- Final review: CHANGELOGs omit app-env configuration, enabled option, app_url and transport health fields, Bandit runtime dependency, always-advertised runtime tools, doctor probing the runtime
- Final review: mcp.ts reports version 0.1.0 while package.json is 0.1.0-alpha.1 (plan 3 aligns)
- Final review: no test that a production host starts no listener; cli-runtime test does not restore LITEWAVE_HOME
- Final review: stale-socket replacement checks only ECONNREFUSED, not the descriptor PID (spec 4.3 deviation, accepted)

## Rulings that amended the plan

- Ruling: work on branch socket-transport in place, not a worktree — user said "no need to use worktrees"; repo has no remote — costs nothing if wrong beyond a branch switch.
- | Transitional | After T1 and before T6, Plug registration: option requires phoenix.json project_id == key while Node still writes the UUID | Ruling: accept; dev-only intermediate state within one branch — cost: none once T6 lands |
- Task 3: Ruling: post-bind failure must stop the Bandit server and remove the socket — plan code leaked a serving Bandit in :disabled state; spec 4.1 requires consistent never-crash behaviour — cost if wrong: a few lines and one test
- Task 3: Ruling: init/1 must catch exits as well as raises (GenServer.call to Runtime can exit) — spec 4.1 never-crash — cost if wrong: none material
- Task 3: Ruling: stale socket removed only on :econnrefused; any other probe error disables with a reason — spec 4.3 "only a dead socket is replaced" — cost if wrong: an :eacces/:timeout case stays disabled until restart instead of being replaced (safe direction)
- Task 4: Ruling: AppURL.detect must catch throws as well as raises and exits (plan code caught only rescue and :exit) — spec 4.1 never-crash — cost if wrong: none
- Task 6: Ruling: resolveRuntime always canonicalises with realpath (no literal-path-first attempt); both tests use `await realpath(root)` as the project — spec 4.4 identity is the canonical path, matching Elixir Source.canonical — cost if wrong: a test edit
- Task 6: Ruling: accept `agent: false` in src/http.ts — pooled keep-alive sockets masked the drop case and would also pool Unix sockets across targets; one request per connection matches the one-shot request model — cost if wrong: minor per-request overhead in a dev tool
- Task 6: Ruling: `sent` set on the request socket's connect event (brief anticipated) — refused connections report dispatch_occurred false — cost: none
- Task 6: Ruling: src/supervisor.ts doctor() call site fixed in the same commit — tsc will not compile otherwise; add to the task's file list — cost: none
- Task 6: Ruling: JSON.parse of a 2xx body must be caught and, for mutations, reported outcome_unknown (invalid_response) — spec 5.1 lost-response semantics unchanged / never replay — cost if wrong: none
- Task 6: Ruling: restore a hard total deadline (setTimeout + req.destroy, cleared on settle) in addition to the socket idle timeout — spec 5.1 "timeouts unchanged" — cost if wrong: none
- Task 8: Ruling: accept bridge-script mapping of Node "http" to Elixir "endpoint" for the transport echo check — plan used two names for one transport — cost if wrong: none; deferred minor to unify the name (RuntimeTarget.kind vs config.transport) in plan 2
- Final: Ruling: fix AppURL.detect to iterate Process.registered() and never force-load modules — measured 776 ms / 1,036 modules loaded on first health call; breaks 2 s health timeout on real apps — cost if wrong: none
- Final: Ruling: Paths.home/1 applies Path.expand so Elixir and Node normalise LITEWAVE_HOME identically — otherwise descriptor identity fails permanently with a misleading error — cost: none
- Final: Ruling: enforce ownership/0700 on $LITEWAVE_HOME and projects/ in Elixir, and lstat-check run dir (0700, owned) and socket (isSocket, owned) in Node before connecting — closes the shared-/tmp home substitution attack — cost: a few lines
- Final: Ruling: when the socket attempt fails before dispatch (sent === false) and phoenix.json exists, callPhoenix falls back to the HTTP target — abrupt halts leave stale descriptors routinely; safe because nothing was dispatched — cost: one extra connect attempt
- Final: Ruling: implement spec 4.6 for the Plug — Config.new/1 merges :litewave_phoenix app env under the Plug arguments — plan omitted it — cost: none
- Final: Ruling: guard Supervisor.stop in abort_start with catch :exit; single warning uses Exception.message not a stack trace — tidiness
- Final: fix wave committed 8e8942b..a94db4a (7 commits). Ruling: accept skipping the Node privacy check when run dir or socket is absent — a nonexistent path cannot receive traffic; connect fails with sent=false — cost: none
