# Socket Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The `litewave_phoenix` package publishes its runtime tools over a Unix domain socket at app boot, and the Node bridge finds that socket from the project directory alone, so a Phoenix developer installs one dependency and needs no port, token, or Plug line.

**Architecture:** The Elixir application supervisor gains a `Litewave.Listener` that starts Bandit on `ip: {:local, path}`, serving the same request handler the existing Plug uses, and writes a `runtime.json` descriptor. The Node bridge gains `resolveRuntime(project)`, which prefers the socket and falls back to the existing HTTP endpoint, and the CLI and MCP server stop requiring a browser registration for runtime tools. The Plug transport keeps its token, Host, Origin, and loopback checks.

**Tech Stack:** Elixir 1.17+, Bandit 1.12, Plug 1.20, Jason, Req (tests); Node 24, TypeScript, `node:http` with `socketPath`, MCP SDK, node:test.

**Spec:** `docs/superpowers/specs/2026-09-24-hex-npm-release-design.md` (sections 4, 5, 8)

This is plan 1 of 3. Plan 2 (quality and docs sweep) and plan 3 (release engineering) follow once this plan's tests pass.

## Global Constraints

- Elixir requirement stays `~> 1.17`; do not use APIs newer than 1.17.
- Node engines stay `>=24.21.0 <25`. Dependencies are exact versions; do not add npm dependencies.
- The library never crashes the host application. Every listener failure logs one warning and the `:litewave_phoenix` application still starts.
- Socket paths must fit in 100 bytes. The message is: `LITEWAVE_HOME is too long for a Unix socket. Choose a shorter path.`
- No token on the socket transport. The Plug transport's authorization is unchanged.
- Production detection is unchanged: `Litewave.Config.environment/0` must return `:dev` or `:test`, else no listener starts.
- Protocol version stays `1`. The envelope field `project_id` now carries the project key (first 24 hex chars of SHA-256 of the canonical project path) on both transports.
- Run `mix precommit` in `packages/phoenix` (after `npm run build` at the root) and `npm run check` at the root before every commit that touches the respective side.
- Commit messages: imperative mood, one line, no trailer.

## Review Focus

1. A stale `runtime.json` whose socket refuses connections (the app is down): the CLI must report `runtime_unavailable` with a message that says the app appears to be down, not `permission_denied`. Pinned in Task 6.
2. A malformed or truncated `runtime.json`: the CLI must return a structured error, never throw an unhandled exception. Pinned in Task 6.
3. A pre-existing `run` directory with loose permissions (0755): the listener must tighten it to 0700 before creating the socket. Pinned in Task 3.
4. `litewave init` without `--app` and with no runtime published: the error must name `--app` and say no runtime reported an application URL. Pinned in Task 7.
5. Health requested while a Phoenix endpoint module is loaded but its server process is not running: `app_url` must be null, not an exception. Pinned in Task 4.

---

## File Structure

Elixir (`packages/phoenix`):

- Create `lib/litewave/paths.ex`: home directory, project key, socket and descriptor paths, length check, private directory creation. Pure functions plus filesystem helpers. No processes.
- Create `lib/litewave/handler.ex`: the request handling extracted from `lib/litewave.ex` (GET health, POST dispatch, validation, bounding, responding). Shared by both transports.
- Create `lib/litewave/socket_plug.ex`: a module Plug for the socket listener that routes `/litewave/runtime` to `Litewave.Handler` and returns 404 elsewhere. No authorization beyond the filesystem.
- Create `lib/litewave/listener.ex`: GenServer that starts Bandit on the socket, writes and removes the descriptor, handles stale sockets, and never fails to start.
- Create `lib/litewave/app_url.ex`: detects a running Phoenix endpoint and returns its URL.
- Modify `lib/litewave.ex`: keep `init/1`, `call/2`, `authorize/2`; delegate handling to `Litewave.Handler`.
- Modify `lib/litewave/config.ex`: extract `base/1`, add `socket/1`, default `project_id` to the project key, use `Litewave.Paths`.
- Modify `lib/litewave/application.ex`: add `Litewave.Listener` when enabled.
- Modify `mix.exs`: Bandit becomes a runtime dependency.
- Modify `config/config.exs`: `enabled: false` in test.
- Create `test/paths_test.exs`, `test/listener_test.exs`, `test/socket_test.exs`, `test/support/phoenix_endpoint.ex`.
- Modify `test/runtime_test.exs`, `test/http_test.exs` where identity changes.

Node (root):

- Create `src/http.ts`: `requestJson` over a Unix socket or URL with a 1 MiB bound and a `sent` flag on failure.
- Modify `src/storage.ts`: `projectKey`, `projectDirectory`, `runtimeSocketPath`, `RuntimeDescriptor`.
- Modify `src/phoenix.ts`: `resolveRuntime`, `callPhoenix(project, ...)`, `setupPhoenix` writes the key.
- Modify `src/mcp.ts`: registration optional.
- Modify `src/cli.ts`: registration optional for `mcp` and `phoenix`; `init` without `--app`.
- Modify `src/index.ts`: export new names.
- Modify `test/phoenix.test.ts`, `test/phoenix-bridge.integration.mjs`; create `test/runtime-paths.test.ts`, `test/cli-runtime.test.ts`.

---

### Task 1: Extract the shared request handler and default the project identity to the project key

**Files:**

- Create: `packages/phoenix/lib/litewave/paths.ex`
- Create: `packages/phoenix/lib/litewave/handler.ex`
- Modify: `packages/phoenix/lib/litewave.ex`
- Modify: `packages/phoenix/lib/litewave/config.ex`
- Test: `packages/phoenix/test/paths_test.exs`
- Test: `packages/phoenix/test/runtime_test.exs`

**Interfaces:**

- Produces: `Litewave.Paths.home/1`, `Litewave.Paths.key/1`, `Litewave.Paths.for_project/2` returning `%{home, key, socket, descriptor}`, `Litewave.Paths.check_length/1`, `Litewave.Paths.private_dir/1`.
- Produces: `Litewave.Handler.handle(conn, config)` and `Litewave.Handler.capabilities(config)`.
- Produces: `Litewave.Config.new/1` unchanged in behaviour except `project_id` is optional and defaults to `Litewave.Paths.key(project)`; `Litewave.Config.current_uid/0` becomes public.

- [ ] **Step 1: Write the failing Paths test**

```elixir
# packages/phoenix/test/paths_test.exs
defmodule Litewave.PathsTest do
  use ExUnit.Case, async: true
  alias Litewave.Paths

  test "key is the first 24 hex characters of sha256 of the canonical project" do
    expected =
      :crypto.hash(:sha256, "/tmp/project") |> Base.encode16(case: :lower) |> binary_part(0, 24)

    assert Paths.key("/tmp/project") == expected
    assert byte_size(Paths.key("/tmp/project")) == 24
  end

  test "socket and descriptor derive from home and project only" do
    paths = Paths.for_project("/tmp/project", "/tmp/lw-home")
    key = Paths.key("/tmp/project")
    assert paths.home == "/tmp/lw-home"
    assert paths.key == key
    assert paths.socket == "/tmp/lw-home/run/p" <> binary_part(key, 0, 16) <> ".sock"
    assert paths.descriptor == "/tmp/lw-home/projects/" <> key <> "/runtime.json"
  end

  test "home honours the explicit override, then LITEWAVE_HOME, then ~/.litewave" do
    assert Paths.home("/explicit") == "/explicit"
    System.put_env("LITEWAVE_HOME", "/from-env")
    on_exit(fn -> System.delete_env("LITEWAVE_HOME") end)
    assert Paths.home(nil) == "/from-env"
    System.delete_env("LITEWAVE_HOME")
    assert Paths.home(nil) == Path.join(System.user_home!(), ".litewave")
  end

  test "socket paths longer than 100 bytes are refused with the documented message" do
    long = String.duplicate("a", 101)
    assert Paths.check_length(long) ==
             {:error, "LITEWAVE_HOME is too long for a Unix socket. Choose a shorter path."}
    assert Paths.check_length(String.duplicate("a", 100)) == :ok
  end

  test "private_dir creates an owner-only directory and tightens loose permissions" do
    dir = Path.join(System.tmp_dir!(), "lw-paths-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(dir) end)
    assert :ok = Paths.private_dir(dir)
    assert Bitwise.band(File.stat!(dir).mode, 0o777) == 0o700
    File.chmod!(dir, 0o755)
    assert :ok = Paths.private_dir(dir)
    assert Bitwise.band(File.stat!(dir).mode, 0o777) == 0o700
  end
end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/phoenix && mix test test/paths_test.exs`
Expected: FAIL with `module Litewave.Paths is not available`

- [ ] **Step 3: Write Litewave.Paths**

```elixir
# packages/phoenix/lib/litewave/paths.ex
defmodule Litewave.Paths do
  @moduledoc false
  import Bitwise

  @too_long "LITEWAVE_HOME is too long for a Unix socket. Choose a shorter path."

  def home(override \\ nil) do
    override || System.get_env("LITEWAVE_HOME") || Path.join(System.user_home!(), ".litewave")
  end

  def key(project) when is_binary(project) do
    :crypto.hash(:sha256, project) |> Base.encode16(case: :lower) |> binary_part(0, 24)
  end

  def for_project(project, home_override \\ nil) do
    home = home(home_override)
    key = key(project)

    %{
      home: home,
      key: key,
      socket: Path.join([home, "run", "p" <> binary_part(key, 0, 16) <> ".sock"]),
      descriptor: Path.join([home, "projects", key, "runtime.json"])
    }
  end

  def check_length(socket) when byte_size(socket) > 100, do: {:error, @too_long}
  def check_length(_socket), do: :ok

  def private_dir(dir) do
    with :ok <- File.mkdir_p(dir),
         {:ok, %{type: :directory, uid: uid, mode: mode}} <- File.lstat(dir),
         true <- uid == Litewave.Config.current_uid() || {:error, :not_owned},
         :ok <- if((mode &&& 0o777) == 0o700, do: :ok, else: File.chmod(dir, 0o700)) do
      :ok
    else
      {:ok, _other} -> {:error, :not_a_directory}
      {:error, reason} -> {:error, reason}
    end
  end
end
```

- [ ] **Step 4: Make current_uid public and route Config through Paths**

In `packages/phoenix/lib/litewave/config.ex`:

Replace `defp current_uid do` with `def current_uid do`.

Replace the `explicit/1` function and `from_registration/2` with:

```elixir
  defp explicit(opts) do
    endpoint = opts |> Keyword.fetch!(:endpoint) |> URI.parse()

    unless endpoint.scheme in ["http", "https"] and
             endpoint.host in ["localhost", "127.0.0.1", "::1"] and
             is_nil(endpoint.userinfo) and is_nil(endpoint.query) and is_nil(endpoint.fragment) and
             endpoint.path in [nil, "", "/"] do
      raise ArgumentError, "Litewave endpoint must be an explicit loopback HTTP(S) origin"
    end

    opts
    |> base()
    |> Map.merge(%{
      transport: :endpoint,
      endpoint: endpoint,
      token_file: opts |> Keyword.fetch!(:token_file) |> Path.expand()
    })
  end

  # Fields shared by both transports. `project_id` defaults to the project key.
  defp base(opts) do
    environment = Keyword.get(opts, :environment, environment())

    unless environment() in [:dev, :test] and environment in [:dev, :test] do
      raise ArgumentError, "Litewave runtime access is development-only"
    end

    project = opts |> Keyword.fetch!(:project) |> Path.expand()

    %{
      project: project,
      project_id: Keyword.get(opts, :project_id, Litewave.Paths.key(project)),
      owner_uid: current_uid(),
      environment: environment,
      roots: Enum.uniq([project | Keyword.get(opts, :roots, dependency_roots())]),
      repos: Keyword.get(opts, :repos, repositories()),
      allow_eval: boolean_option(opts, :allow_eval),
      allow_sql: boolean_option(opts, :allow_sql),
      max_output_bytes: bounded(opts, :max_output_bytes, 64_000, 1024, 256_000),
      max_rows: bounded(opts, :max_rows, 50, 1, 500),
      timeout: bounded(opts, :timeout, 10_000, 1, 30_000)
    }
  end

  defp from_registration(project, opts) do
    with {:ok, project} <- Litewave.Source.canonical(project),
         paths = Litewave.Paths.for_project(project),
         directory = Path.dirname(paths.descriptor),
         {:ok, data} <- File.read(Path.join(directory, "registration.json")),
         {:ok, %{"project" => ^project}} <- Jason.decode(data),
         {:ok, data} <- File.read(Path.join(directory, "phoenix.json")),
         {:ok, %{"project_id" => project_id, "endpoint" => endpoint, "token_file" => token_file}} <-
           Jason.decode(data),
         true <- project_id == paths.key do
      origin = endpoint |> URI.parse() |> Map.put(:path, nil) |> URI.to_string()

      explicit(
        Keyword.merge(opts,
          project: project,
          project_id: project_id,
          endpoint: origin,
          token_file: token_file
        )
      )
    else
      _ ->
        raise ArgumentError,
              "Litewave registration is missing or mismatched. Run litewave init and litewave phoenix setup for this project first."
    end
  end
```

Delete the old `explicit/1` body's duplicated fields; `explicit/1` now calls `base/1`.

- [ ] **Step 5: Extract Litewave.Handler**

Create `packages/phoenix/lib/litewave/handler.ex` by moving from `lib/litewave.ex` the functions `handle/2` (all three clauses), `validate/2`, `valid_arguments?/2`, `bounded/2`, and `respond/3`, plus the `@methods` attribute. Make `handle/2` public and add `capabilities/1`:

```elixir
# packages/phoenix/lib/litewave/handler.ex
defmodule Litewave.Handler do
  @moduledoc false
  import Plug.Conn
  alias Litewave.Runtime

  @methods ~w(get_docs get_source_location get_logs project_eval execute_sql_query)

  def capabilities(config) do
    ~w(get_docs get_source_location get_logs) ++
      if(config.allow_eval, do: ["project_eval"], else: []) ++
      if(config.allow_sql, do: ["execute_sql_query"], else: [])
  end

  def handle(%{method: "GET"} = conn, config) do
    respond(conn, 200, %{
      protocol_version: 1,
      project_id: config.project_id,
      project: config.project,
      runtime_id: Runtime.identity(),
      environment: config.environment,
      elixir: System.version(),
      otp: System.otp_release(),
      capabilities: capabilities(config),
      repos: Enum.map(config.repos, &inspect/1),
      sql_mode: if(config.allow_sql, do: "read_write", else: "disabled"),
      transport: config.transport
    })
  end

  # POST clause, 405 clause, validate/2, valid_arguments?/2, bounded/2, respond/3:
  # move verbatim from lib/litewave.ex.
end
```

Then reduce `lib/litewave.ex` to `init/1`, `call/2` (both clauses), and `authorize/2`, with the success branch of `call/2` calling `Litewave.Handler.handle(conn, config)` and the failure branch calling `Litewave.Handler.respond/3`. Make `respond/3` public in the Handler for that purpose.

- [ ] **Step 6: Assert the default identity in runtime_test**

Add to `packages/phoenix/test/runtime_test.exs`, after the existing health test:

```elixir
  test "project_id defaults to the project key when not supplied", ctx do
    config = Litewave.init(Keyword.delete(ctx.opts, :project_id))
    assert config.project_id == Litewave.Paths.key(config.project)
    assert config.transport == :endpoint
  end
```

- [ ] **Step 7: Run the Elixir suite**

Run: `cd packages/phoenix && mix precommit`
Expected: all tests pass, no warnings. The Node bridge test still passes because the fixture supplies an explicit `project_id`.

- [ ] **Step 8: Commit**

```bash
git add packages/phoenix/lib packages/phoenix/test
git commit -m "Extract shared runtime handler and derive project identity from project key"
```

---

### Task 2: Socket configuration from application environment

**Files:**

- Modify: `packages/phoenix/lib/litewave/config.ex`
- Test: `packages/phoenix/test/runtime_test.exs`

**Interfaces:**

- Produces: `Litewave.Config.socket(opts \\ [])` returning the same map as `new/1` with `transport: :socket`, `endpoint: nil`, `token_file: nil`. Options come from `Application.get_all_env(:litewave_phoenix)` merged with `opts`; `project` defaults to the directory of `Mix.Project.project_file()`, canonicalised.

- [ ] **Step 1: Write the failing test**

Add to `packages/phoenix/test/runtime_test.exs`:

```elixir
  test "socket config reads application environment, canonicalises the project, and has no endpoint" do
    Application.put_env(:litewave_phoenix, :allow_eval, true)
    on_exit(fn -> Application.delete_env(:litewave_phoenix, :allow_eval) end)
    config = Litewave.Config.socket(environment: :test)
    {:ok, expected} = Litewave.Source.canonical(Path.dirname(Mix.Project.project_file()))
    assert config.project == expected
    assert config.project_id == Litewave.Paths.key(expected)
    assert config.transport == :socket
    assert config.endpoint == nil
    assert config.token_file == nil
    assert config.allow_eval == true
    assert config.allow_sql == false
    assert Litewave.Config.socket(environment: :test, allow_eval: false).allow_eval == false
  end
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/phoenix && mix test test/runtime_test.exs`
Expected: FAIL with `function Litewave.Config.socket/1 is undefined`

- [ ] **Step 3: Implement socket/1**

Add to `packages/phoenix/lib/litewave/config.ex` after `new/1`:

```elixir
  @env_options ~w(allow_eval allow_sql repos roots timeout max_output_bytes max_rows project environment)a

  def socket(opts \\ []) when is_list(opts) do
    from_env = :litewave_phoenix |> Application.get_all_env() |> Keyword.take(@env_options)
    opts = Keyword.merge(from_env, opts)

    project =
      case Keyword.fetch(opts, :project) do
        {:ok, project} -> project
        :error -> Path.dirname(Mix.Project.project_file())
      end

    project =
      case Litewave.Source.canonical(project) do
        {:ok, canonical} -> canonical
        _ -> Path.expand(project)
      end

    opts
    |> Keyword.put(:project, project)
    |> base()
    |> Map.merge(%{transport: :socket, endpoint: nil, token_file: nil})
  end
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/phoenix && mix test test/runtime_test.exs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/phoenix/lib/litewave/config.ex packages/phoenix/test/runtime_test.exs
git commit -m "Add socket transport configuration from application environment"
```

---

### Task 3: Listener with Bandit on a Unix socket, descriptor, and stale-socket handling

**Files:**

- Create: `packages/phoenix/lib/litewave/socket_plug.ex`
- Create: `packages/phoenix/lib/litewave/listener.ex`
- Modify: `packages/phoenix/mix.exs` (Bandit runtime dependency)
- Test: `packages/phoenix/test/listener_test.exs`

**Interfaces:**

- Consumes: `Litewave.Config.socket/1`, `Litewave.Paths.for_project/2`, `Litewave.Handler.handle/2`, `Litewave.Handler.capabilities/1`, `Litewave.Runtime.identity/0`.
- Produces: `Litewave.Listener.start_link(opts)` with options `home:`, `config:`, `name:`; `Litewave.Listener.info(server \\ Litewave.Listener)` returning `%{status: :listening | :disabled, socket: String.t(), descriptor: String.t(), reason: nil | String.t()}`.
- Produces: descriptor JSON at `paths.descriptor` with keys `version, project, project_id, runtime_id, os_pid, socket, started_at, capabilities`.

- [ ] **Step 1: Make Bandit a runtime dependency**

In `packages/phoenix/mix.exs`, change `{:bandit, "~> 1.10", only: :test}` to `{:bandit, "~> 1.10"}`. Run `cd packages/phoenix && mix deps.get` and confirm `mix.lock` is unchanged apart from ordering.

- [ ] **Step 2: Write the failing listener tests**

```elixir
# packages/phoenix/test/listener_test.exs
defmodule Litewave.ListenerTest do
  use ExUnit.Case, async: false
  import Bitwise
  import ExUnit.CaptureLog
  alias Litewave.{Listener, Paths}

  setup do
    home = "/tmp/lw-#{System.unique_integer([:positive])}"
    File.mkdir_p!(home)
    on_exit(fn -> File.rm_rf!(home) end)
    config = Litewave.Config.socket(environment: :test, allow_eval: true)
    %{home: home, config: config, paths: Paths.for_project(config.project, home)}
  end

  defp start(ctx, extra \\ []) do
    opts = Keyword.merge([home: ctx.home, config: ctx.config, name: nil], extra)
    start_supervised!({Listener, opts}, id: extra[:id] || Listener)
  end

  defp health(socket) do
    Req.get!("http://localhost/litewave/runtime", unix_socket: socket, retry: false)
  end

  test "publishes a private socket and descriptor, answers health, and cleans up on stop", ctx do
    pid = start(ctx)
    assert %{status: :listening, reason: nil} = Listener.info(pid)
    assert (File.stat!(ctx.paths.socket).mode &&& 0o777) == 0o600
    assert (File.stat!(Path.dirname(ctx.paths.socket)).mode &&& 0o777) == 0o700
    assert (File.stat!(ctx.paths.descriptor).mode &&& 0o777) == 0o600

    descriptor = ctx.paths.descriptor |> File.read!() |> Jason.decode!()
    assert descriptor["version"] == 1
    assert descriptor["project"] == ctx.config.project
    assert descriptor["project_id"] == ctx.paths.key
    assert descriptor["runtime_id"] == Litewave.Runtime.identity()
    assert descriptor["os_pid"] == String.to_integer(System.pid())
    assert descriptor["socket"] == ctx.paths.socket
    assert "project_eval" in descriptor["capabilities"]
    assert {:ok, _, _} = DateTime.from_iso8601(descriptor["started_at"])

    response = health(ctx.paths.socket)
    assert response.status == 200
    assert response.body["project_id"] == ctx.paths.key
    assert response.body["transport"] == "socket"
    assert response.body["runtime_id"] == Litewave.Runtime.identity()

    assert Req.get!("http://localhost/other", unix_socket: ctx.paths.socket, retry: false).status ==
             404

    :ok = stop_supervised!(Listener)
    refute File.exists?(ctx.paths.socket)
    refute File.exists?(ctx.paths.descriptor)
  end

  test "replaces a stale socket whose owner is gone", ctx do
    File.mkdir_p!(Path.dirname(ctx.paths.socket))
    {:ok, stale} = :gen_tcp.listen(0, ip: {:local, ctx.paths.socket})
    :gen_tcp.close(stale)
    assert File.exists?(ctx.paths.socket)
    pid = start(ctx)
    assert %{status: :listening} = Listener.info(pid)
    assert health(ctx.paths.socket).status == 200
  end

  test "leaves a live socket alone and reports the conflict", ctx do
    first = start(ctx, id: :first)
    assert %{status: :listening} = Listener.info(first)

    log =
      capture_log(fn ->
        second = start(ctx, id: :second)
        assert %{status: :disabled, reason: reason} = Listener.info(second)
        assert reason =~ "already"
      end)

    assert log =~ "Litewave runtime socket is unavailable"
    assert health(ctx.paths.socket).status == 200
  end

  test "a too-long home warns and the process still starts", ctx do
    long_home = Path.join(ctx.home, String.duplicate("x", 90))

    log =
      capture_log(fn ->
        pid = start(ctx, home: long_home)
        assert %{status: :disabled, reason: reason} = Listener.info(pid)
        assert reason == "LITEWAVE_HOME is too long for a Unix socket. Choose a shorter path."
      end)

    assert log =~ "too long"
  end

  test "tightens a loose run directory before listening", ctx do
    run = Path.dirname(ctx.paths.socket)
    File.mkdir_p!(run)
    File.chmod!(run, 0o755)
    start(ctx)
    assert (File.stat!(run).mode &&& 0o777) == 0o700
  end
end
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/phoenix && mix test test/listener_test.exs`
Expected: FAIL with `module Litewave.Listener is not available`

- [ ] **Step 4: Write Litewave.SocketPlug**

```elixir
# packages/phoenix/lib/litewave/socket_plug.ex
defmodule Litewave.SocketPlug do
  @moduledoc false
  @behaviour Plug
  import Plug.Conn

  @impl true
  def init(config), do: config

  @impl true
  def call(%{path_info: ["litewave", "runtime"]} = conn, config) do
    if is_pid(Process.whereis(Litewave.Runtime)) do
      Litewave.Handler.handle(conn, config)
    else
      Litewave.Handler.respond(
        conn,
        503,
        Litewave.Runtime.error("runtime_unavailable", "Runtime is restarting.", false)
      )
    end
  end

  def call(conn, _config) do
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(404, Jason.encode!(%{error: %{code: "not_found", message: "Unknown path."}}))
    |> halt()
  end
end
```

- [ ] **Step 5: Write Litewave.Listener**

```elixir
# packages/phoenix/lib/litewave/listener.ex
defmodule Litewave.Listener do
  @moduledoc false
  use GenServer
  require Logger
  alias Litewave.Paths

  def start_link(opts) do
    case Keyword.get(opts, :name, __MODULE__) do
      nil -> GenServer.start_link(__MODULE__, opts)
      name -> GenServer.start_link(__MODULE__, opts, name: name)
    end
  end

  def info(server \\ __MODULE__), do: GenServer.call(server, :info)

  @impl true
  def init(opts) do
    Process.flag(:trap_exit, true)

    state =
      try do
        config = Keyword.get_lazy(opts, :config, fn -> Litewave.Config.socket() end)
        paths = Paths.for_project(config.project, Keyword.get(opts, :home))

        case start(config, paths) do
          {:ok, server} ->
            %{status: :listening, server: server, socket: paths.socket, descriptor: paths.descriptor, reason: nil}

          {:error, reason} ->
            disabled(paths, reason)
        end
      rescue
        error ->
          disabled(%{socket: nil, descriptor: nil}, Exception.message(error))
      end

    {:ok, state}
  end

  defp disabled(paths, reason) do
    reason = if is_binary(reason), do: reason, else: inspect(reason)
    Logger.warning("Litewave runtime socket is unavailable: #{reason}")
    %{status: :disabled, server: nil, socket: paths.socket, descriptor: paths.descriptor, reason: reason}
  end

  defp start(config, paths) do
    with :ok <- Paths.check_length(paths.socket),
         :ok <- Paths.private_dir(Path.dirname(paths.socket)),
         :ok <- Paths.private_dir(Path.dirname(paths.descriptor)),
         :ok <- clear_stale(paths.socket),
         {:ok, server} <-
           Bandit.start_link(
             plug: {Litewave.SocketPlug, config},
             ip: {:local, paths.socket},
             port: 0,
             startup_log: false
           ),
         :ok <- File.chmod(paths.socket, 0o600),
         :ok <- write_descriptor(paths, config) do
      {:ok, server}
    end
  end

  # A socket that accepts a connection has a live owner: report, never replace.
  defp clear_stale(socket) do
    case :gen_tcp.connect({:local, socket}, 0, [:local, active: false], 1_000) do
      {:ok, port} ->
        :gen_tcp.close(port)
        {:error, "another runtime already serves #{socket}"}

      {:error, :enoent} ->
        :ok

      {:error, _refused} ->
        case File.rm(socket) do
          :ok -> :ok
          {:error, :enoent} -> :ok
          {:error, reason} -> {:error, "cannot remove stale socket: #{inspect(reason)}"}
        end
    end
  end

  defp write_descriptor(paths, config) do
    descriptor = %{
      version: 1,
      project: config.project,
      project_id: config.project_id,
      runtime_id: Litewave.Runtime.identity(),
      os_pid: String.to_integer(System.pid()),
      socket: paths.socket,
      started_at: DateTime.utc_now() |> DateTime.truncate(:second) |> DateTime.to_iso8601(),
      capabilities: Litewave.Handler.capabilities(config)
    }

    temp = paths.descriptor <> ".#{System.unique_integer([:positive])}.partial"

    with :ok <- File.write(temp, Jason.encode!(descriptor) <> "\n"),
         :ok <- File.chmod(temp, 0o600),
         :ok <- File.rename(temp, paths.descriptor) do
      :ok
    else
      {:error, reason} ->
        File.rm(temp)
        {:error, "cannot write runtime descriptor: #{inspect(reason)}"}
    end
  end

  @impl true
  def handle_call(:info, _from, state) do
    {:reply, Map.take(state, [:status, :socket, :descriptor, :reason]), state}
  end

  @impl true
  def handle_info({:EXIT, pid, reason}, %{server: pid} = state) do
    cleanup(state)
    {:noreply, disabled(state, "listener exited: #{inspect(reason)}")}
  end

  def handle_info(_message, state), do: {:noreply, state}

  @impl true
  def terminate(_reason, state), do: cleanup(state)

  defp cleanup(%{status: :listening} = state) do
    if state.descriptor, do: File.rm(state.descriptor)
    if state.socket, do: File.rm(state.socket)
    :ok
  end

  defp cleanup(_state), do: :ok
end
```

- [ ] **Step 6: Run the listener tests**

Run: `cd packages/phoenix && mix test test/listener_test.exs`
Expected: PASS (5 tests). If Req rejects `unix_socket`, confirm the Req version in `mix.lock` is 0.5 or newer; the option exists there.

- [ ] **Step 7: Run precommit and commit**

Run: `cd packages/phoenix && mix precommit`
Expected: PASS, no warnings.

```bash
git add packages/phoenix/mix.exs packages/phoenix/mix.lock packages/phoenix/lib packages/phoenix/test/listener_test.exs
git commit -m "Publish the runtime over a private Unix socket with a boot descriptor"
```

---

### Task 4: Wire the listener into the application and add app_url discovery

**Files:**

- Create: `packages/phoenix/lib/litewave/app_url.ex`
- Create: `packages/phoenix/test/support/phoenix_endpoint.ex`
- Modify: `packages/phoenix/lib/litewave/application.ex`
- Modify: `packages/phoenix/lib/litewave/handler.ex`
- Modify: `packages/phoenix/config/config.exs`
- Test: `packages/phoenix/test/runtime_test.exs`

**Interfaces:**

- Produces: `Litewave.AppURL.detect/0` returning `String.t() | nil`.
- Produces: health JSON gains `"app_url": string | null`.
- Produces: application env `enabled: boolean` (default true) controls the listener child.

- [ ] **Step 1: Write the failing tests**

Create the fake endpoint:

```elixir
# packages/phoenix/test/support/phoenix_endpoint.ex
defmodule Litewave.TestPhoenixEndpoint do
  @moduledoc false
  # Mimics the functions Litewave.AppURL uses to recognise a Phoenix endpoint.
  def __sockets__, do: []
  def url, do: "http://localhost:4123"
  def struct_url, do: URI.parse(url())
end
```

Add to `packages/phoenix/test/runtime_test.exs`:

```elixir
  test "health reports app_url only while a Phoenix endpoint process is running", ctx do
    assert Litewave.AppURL.detect() == nil
    assert Jason.decode!(request(ctx, :get).resp_body)["app_url"] == nil

    {:ok, agent} = Agent.start_link(fn -> nil end, name: Litewave.TestPhoenixEndpoint)
    assert Litewave.AppURL.detect() == "http://localhost:4123"
    assert Jason.decode!(request(ctx, :get).resp_body)["app_url"] == "http://localhost:4123"
    Agent.stop(agent)
    assert Litewave.AppURL.detect() == nil
  end

  test "the listener child is controlled by the enabled flag" do
    children = Supervisor.which_children(Litewave.Supervisor) |> Enum.map(&elem(&1, 0))
    refute Litewave.Listener in children, "test config sets enabled: false"
    assert Litewave.Application.children(true) |> Enum.member?(Litewave.Listener)
    refute Litewave.Application.children(false) |> Enum.member?(Litewave.Listener)
  end
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/phoenix && mix test test/runtime_test.exs`
Expected: FAIL with `module Litewave.AppURL is not available`

- [ ] **Step 3: Write Litewave.AppURL**

```elixir
# packages/phoenix/lib/litewave/app_url.ex
defmodule Litewave.AppURL do
  @moduledoc false

  # A Phoenix endpoint exports __sockets__/0, url/0 and struct_url/0 and runs
  # under its own module name. Phoenix is not a dependency; detect by shape.
  def detect do
    Application.loaded_applications()
    |> Enum.flat_map(fn {app, _, _} -> Application.spec(app, :modules) || [] end)
    |> Enum.find_value(&endpoint_url/1)
  end

  defp endpoint_url(module) do
    if Code.ensure_loaded?(module) and function_exported?(module, :__sockets__, 0) and
         function_exported?(module, :url, 0) and function_exported?(module, :struct_url, 0) and
         is_pid(Process.whereis(module)) do
      try do
        case module.url() do
          url when is_binary(url) -> url
          _ -> nil
        end
      rescue
        _ -> nil
      catch
        :exit, _ -> nil
      end
    end
  end
end
```

- [ ] **Step 4: Add app_url to health**

In `packages/phoenix/lib/litewave/handler.ex`, add `app_url: Litewave.AppURL.detect()` to the GET response map.

- [ ] **Step 5: Wire the application**

```elixir
# packages/phoenix/lib/litewave/application.ex
defmodule Litewave.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    enabled = Application.get_env(:litewave_phoenix, :enabled, true)

    children =
      if Litewave.Config.environment() in [:dev, :test], do: children(enabled), else: []

    Supervisor.start_link(children, strategy: :one_for_all, name: Litewave.Supervisor)
  end

  @doc false
  def children(enabled) do
    [
      {Task.Supervisor, name: Litewave.TaskSupervisor},
      Litewave.Logs,
      Litewave.Runtime
    ] ++ if(enabled, do: [Litewave.Listener], else: [])
  end
end
```

Note `Litewave.Listener` is under a `:one_for_all` supervisor; because its `init/1` never returns an error, a listener problem cannot restart `Runtime` or `Logs`.

- [ ] **Step 6: Disable the app-level listener in the test environment**

```elixir
# packages/phoenix/config/config.exs
import Config

if config_env() == :test do
  config :logger, level: :warning
  # Tests start their own listeners under temporary homes.
  config :litewave_phoenix, enabled: false
end
```

- [ ] **Step 7: Run precommit and commit**

Run: `cd packages/phoenix && mix precommit`
Expected: PASS.

```bash
git add packages/phoenix/lib packages/phoenix/config packages/phoenix/test
git commit -m "Start the socket listener at boot and report the Phoenix app URL in health"
```

---

### Task 5: Node project key, directory, socket path, and descriptor type

**Files:**

- Modify: `src/storage.ts`
- Test: `test/runtime-paths.test.ts`

**Interfaces:**

- Produces: `projectKey(canonical: string): string`, `projectDirectory(canonical: string): string`, `runtimeSocketPath(canonical: string): string`, and `type RuntimeDescriptor`.
- `register()` and `registration()` keep their behaviour; `register` now uses `projectDirectory` for `directory`.

- [ ] **Step 1: Write the failing test**

```ts
// test/runtime-paths.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  home,
  projectDirectory,
  projectKey,
  runtimeSocketPath,
} from "../src/storage.js";

test("runtime paths derive from LITEWAVE_HOME and the canonical project only", () => {
  const previous = process.env.LITEWAVE_HOME;
  process.env.LITEWAVE_HOME = "/tmp/lw-home";
  try {
    const canonical = "/tmp/project";
    const key = createHash("sha256")
      .update(canonical)
      .digest("hex")
      .slice(0, 24);
    assert.equal(projectKey(canonical), key);
    assert.equal(home(), "/tmp/lw-home");
    assert.equal(
      projectDirectory(canonical),
      path.join("/tmp/lw-home", "projects", key),
    );
    assert.equal(
      runtimeSocketPath(canonical),
      path.join("/tmp/lw-home", "run", `p${key.slice(0, 16)}.sock`),
    );
  } finally {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/runtime-paths.test.js`
Expected: FAIL at compile time: `Module '"../src/storage.js"' has no exported member 'projectKey'`

- [ ] **Step 3: Implement in storage.ts**

Add after `home`:

```ts
export const projectKey = (canonical: string) => hash(canonical).slice(0, 24);
export const projectDirectory = (canonical: string) =>
  path.join(home(), "projects", projectKey(canonical));
export const runtimeSocketPath = (canonical: string) =>
  path.join(home(), "run", `p${projectKey(canonical).slice(0, 16)}.sock`);
export type RuntimeDescriptor = {
  version: 1;
  project: string;
  project_id: string;
  runtime_id: string;
  os_pid: number;
  socket: string;
  started_at: string;
  capabilities: string[];
};
```

In `register`, replace

```ts
const base = await realpath(await privateDir(home()).then(home));
const directory = path.join(base, "projects", hash(canonical).slice(0, 24));
```

with

```ts
await privateDir(home());
const base = home();
const directory = projectDirectory(canonical);
```

Everything else in `register` stays. In `registration`, replace the `path.join(home(), "projects", hash(canonical).slice(0, 24), "registration.json")` expression with `path.join(projectDirectory(canonical), "registration.json")`.

- [ ] **Step 4: Run the Node checks**

Run: `npm run check`
Expected: PASS. The existing core test that registers two projects still passes because paths only lost a `realpath` on the base.

- [ ] **Step 5: Commit**

```bash
git add src/storage.ts test/runtime-paths.test.ts
git commit -m "Derive runtime socket and descriptor paths from the project key"
```

---

### Task 6: HTTP-over-socket transport and runtime resolution in the Node bridge

**Files:**

- Create: `src/http.ts`
- Modify: `src/phoenix.ts`
- Modify: `src/index.ts`
- Test: `test/phoenix.test.ts`

**Interfaces:**

- Produces: `requestJson(target: HttpTarget, init: { method: "GET" | "POST"; body?: string; headers?: Record<string, string>; timeoutMs: number }): Promise<{ status: number; body: string }>` where `HttpTarget = { socketPath: string; path: string } | { url: URL }`. Throws `TransportError` with `sent: boolean` and `code: "response_too_large" | "connection_failed"`.
- Produces: `resolveRuntime(project: string): Promise<RuntimeTarget>` where `RuntimeTarget = { project: string; projectId: string } & ({ kind: "socket"; socketPath: string } | { kind: "http"; endpoint: URL; tokenFile: string })`.
- Changes: `callPhoenix(project: string, method, input)`; `setupPhoenix(r: Registration)` writes `project_id: projectKey(r.project)`; `phoenixConnection(r)` removed in favour of `resolveRuntime`.

- [ ] **Step 1: Rewrite test/phoenix.test.ts as two tests**

Replace the file with:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  atomicJson,
  projectDirectory,
  projectKey,
  readJson,
  register,
  runtimeSocketPath,
  type Registration,
  type RuntimeDescriptor,
} from "../src/storage.js";
import {
  callPhoenix,
  resolveRuntime,
  setupPhoenix,
  type PhoenixConnection,
  type PhoenixTool,
} from "../src/phoenix.js";

type Fixture = {
  calls: number;
  mode: string;
  authorization: string;
  handler: (req: IncomingMessage, res: ServerResponse) => void;
};
function fixture(project: string, projectId: string): Fixture {
  const f: Fixture = {
    calls: 0,
    mode: "healthy",
    authorization: "",
    handler: (req, res) => {
      f.calls++;
      f.authorization = req.headers.authorization ?? "";
      if (f.mode === "drop") {
        req.socket.destroy();
        return;
      }
      if (f.mode === "redirect") {
        res.writeHead(307, { location: "http://127.0.0.1:1/leak" });
        res.end();
        return;
      }
      if (f.mode === "large") {
        res.end("x".repeat(1_048_577));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          protocol_version: 1,
          project_id: f.mode === "wrong-project" ? "different" : projectId,
          project,
          runtime_id: "instance-1",
          capabilities: [],
          app_url: "http://localhost:4123",
          status: "ok",
        }),
      );
    },
  };
  return f;
}
function withHome(root: string) {
  const previous = process.env.LITEWAVE_HOME;
  process.env.LITEWAVE_HOME = path.join(root, "s");
  return () => {
    if (previous === undefined) delete process.env.LITEWAVE_HOME;
    else process.env.LITEWAVE_HOME = previous;
  };
}

test("socket transport: descriptor resolution, identity checks, bounds, lost responses, stale and malformed descriptors", async () => {
  const root = await mkdtemp("/tmp/lw-s-");
  const restore = withHome(root);
  const project = root;
  const projectId = projectKey(project);
  const f = fixture(project, projectId);
  const server = createServer(f.handler);
  const socketPath = runtimeSocketPath(project);
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  const descriptorFile = path.join(projectDirectory(project), "runtime.json");
  const descriptor: RuntimeDescriptor = {
    version: 1,
    project,
    project_id: projectId,
    runtime_id: "instance-1",
    os_pid: process.pid,
    socket: socketPath,
    started_at: new Date().toISOString(),
    capabilities: ["get_docs"],
  };
  try {
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "phoenix_not_configured",
    );
    await atomicJson(descriptorFile, descriptor);
    const target = await resolveRuntime(project);
    assert.equal(target.kind, "socket");
    const health = await callPhoenix(project, "phoenix_health");
    assert.equal(health.runtime_id, "instance-1");
    assert.equal(health.app_url, "http://localhost:4123");
    assert.equal(f.authorization, "", "no token on the socket transport");

    f.mode = "wrong-project";
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "project_mismatch",
    );
    f.mode = "redirect";
    let before = f.calls;
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "permission_denied",
    );
    assert.equal(f.calls, before + 1);
    f.mode = "drop";
    before = f.calls;
    const lost = await callPhoenix(project, "project_eval", {
      code: ":ok",
      runtime_id: "instance-1",
      request_id: "stable-id",
    });
    assert.equal(lost.status, "outcome_unknown");
    assert.equal(lost.error?.dispatch_occurred, "unknown");
    assert.equal(f.calls, before + 1);
    f.mode = "large";
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "response_too_large",
    );
    f.mode = "healthy";

    // Descriptor pointing somewhere other than the derived socket is rejected.
    await atomicJson(descriptorFile, {
      ...descriptor,
      socket: "/tmp/elsewhere.sock",
    });
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "permission_denied",
    );
    await atomicJson(descriptorFile, { ...descriptor, project: "/other" });
    assert.equal(
      (await callPhoenix(project, "phoenix_health")).error?.code,
      "permission_denied",
    );

    // Malformed descriptor is a structured error, not a crash.
    await writeFile(descriptorFile, "{not json", { mode: 0o600 });
    const malformed = await callPhoenix(project, "phoenix_health");
    assert.equal(malformed.error?.code, "runtime_unavailable");
    assert.match(malformed.error?.message ?? "", /descriptor/);

    // Stale descriptor: socket refuses because the app is down.
    await atomicJson(descriptorFile, descriptor);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const down = await callPhoenix(project, "phoenix_health");
    assert.equal(down.status, "error");
    assert.equal(down.error?.code, "runtime_unavailable");
    assert.match(down.error?.message ?? "", /not running|down/);
    const downMutation = await callPhoenix(project, "project_eval", {
      code: ":ok",
      runtime_id: "instance-1",
      request_id: "never-sent",
    });
    assert.equal(
      downMutation.status,
      "error",
      "refused connections were never dispatched",
    );
    assert.equal(downMutation.error?.dispatch_occurred, false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restore();
    await rm(root, { recursive: true, force: true });
  }
});

test("http fallback: setup is private and idempotent, writes the project key, and verifies the token file", async () => {
  const root = await mkdtemp("/tmp/lw-h-");
  const restore = withHome(root);
  let registration: Registration | undefined;
  const f = fixture(root, projectKey(root));
  const server = createServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    registration = await register(root, `http://127.0.0.1:${port}`);
    const configured = await setupPhoenix(registration);
    const connection = await readJson<PhoenixConnection>(
      path.join(registration.directory, "phoenix.json"),
    );
    assert.equal(connection.project_id, projectKey(registration.project));
    const secret = (await readFile(connection.token_file, "utf8")).trim();
    assert.equal((await stat(connection.token_file)).mode & 0o777, 0o600);
    assert.ok(!JSON.stringify(configured).includes(secret));
    assert.deepEqual(await setupPhoenix(registration), configured);
    const target = await resolveRuntime(root);
    assert.equal(target.kind, "http");
    assert.equal(
      (await callPhoenix(root, "phoenix_health")).runtime_id,
      "instance-1",
    );
    assert.equal(f.authorization, `Bearer ${secret}`);
    await chmod(connection.token_file, 0o644);
    const before = f.calls;
    assert.equal(
      (await callPhoenix(root, "phoenix_health")).error?.code,
      "permission_denied",
    );
    assert.equal(f.calls, before);
    assert.equal(
      (await callPhoenix(root, "__proto__" as PhoenixTool)).error?.code,
      "invalid_request",
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    restore();
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build`
Expected: FAIL at compile time: `resolveRuntime` is not exported and `callPhoenix` does not accept a string.

- [ ] **Step 3: Write src/http.ts**

```ts
// src/http.ts
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export type HttpTarget = { socketPath: string; path: string } | { url: URL };
export class TransportError extends Error {
  constructor(
    public code: "response_too_large" | "connection_failed",
    message: string,
    public sent: boolean,
  ) {
    super(message);
  }
}
const MAX_BYTES = 1_048_576;

export function requestJson(
  target: HttpTarget,
  init: {
    method: "GET" | "POST";
    body?: string;
    headers?: Record<string, string>;
    timeoutMs: number;
  },
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    let sent = false;
    let settled = false;
    const fail = (code: TransportError["code"], message: string) => {
      if (settled) return;
      settled = true;
      reject(new TransportError(code, message, sent));
    };
    const headers = {
      ...(init.headers ?? {}),
      ...(init.body
        ? { "content-length": String(Buffer.byteLength(init.body)) }
        : {}),
    };
    const options = { method: init.method, headers, timeout: init.timeoutMs };
    const req =
      "socketPath" in target
        ? httpRequest({
            ...options,
            socketPath: target.socketPath,
            path: target.path,
          })
        : (target.url.protocol === "https:" ? httpsRequest : httpRequest)(
            target.url,
            options,
          );
    req.on("finish", () => {
      sent = true;
    });
    req.on("timeout", () => {
      req.destroy();
      fail("connection_failed", "Runtime request timed out.");
    });
    req.on("error", (error: NodeJS.ErrnoException) =>
      fail("connection_failed", error.code ?? error.message),
    );
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          res.destroy();
          fail("response_too_large", "Runtime response exceeded 1 MiB.");
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (settled) return;
        settled = true;
        resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
      res.on("error", () =>
        fail("connection_failed", "Runtime response was interrupted."),
      );
    });
    req.end(init.body);
  });
}
```

- [ ] **Step 4: Rewrite the transport parts of src/phoenix.ts**

Keep `phoenixTools`, `PhoenixTool`, `PhoenixResult`, `PhoenixConnection`, `endpoint()`, `token()`, and `runtimeFailure()` as they are. Replace `setupPhoenix`, `phoenixConnection`, and `callPhoenix` with:

```ts
import { realpath } from "node:fs/promises";
import { requestJson, TransportError } from "./http.js";
import {
  exists,
  projectDirectory,
  projectKey,
  readJson,
  runtimeSocketPath,
  type Registration,
  type RuntimeDescriptor,
} from "./storage.js";

export type RuntimeTarget = { project: string; projectId: string } & (
  | { kind: "socket"; socketPath: string }
  | { kind: "http"; endpoint: URL; tokenFile: string }
);

export async function setupPhoenix(r: Registration) {
  const file = path.join(r.directory, "phoenix.json");
  const runtimeEndpoint = endpoint(new URL("/litewave/runtime", r.app).href);
  const projectId = projectKey(r.project);
  if (!(await exists(file))) {
    const tokenFile = path.join(r.directory, "phoenix-token");
    if (!(await exists(tokenFile))) {
      const fd = await open(tokenFile, "wx", 0o600);
      try {
        await fd.writeFile(randomBytes(32).toString("hex") + "\n");
        await fd.sync();
      } finally {
        await fd.close();
      }
    }
    const connection: PhoenixConnection = {
      version: 1,
      endpoint: runtimeEndpoint.href,
      token_file: tokenFile,
      project_id: projectId,
    };
    const fd = await open(file, "wx", 0o600);
    try {
      await fd.writeFile(JSON.stringify(connection, null, 2) + "\n");
      await fd.sync();
    } finally {
      await fd.close();
    }
  }
  const connection = await readJson<PhoenixConnection>(file);
  const literal = (text: string) =>
    JSON.stringify(text).replaceAll("#{", "\\#{");
  return {
    endpoint: connection.endpoint,
    project_id: projectId,
    plug: `if Mix.env() == :dev do\n  plug Litewave,\n    project: ${literal(r.project)},\n    endpoint: ${literal(new URL(connection.endpoint).origin)},\n    token_file: ${literal(connection.token_file)},\n    allow_eval: false,\n    allow_sql: false\nend`,
    next: "This HTTP transport is optional. The default is the Unix socket the litewave_phoenix dependency publishes at boot with no Plug or token. Use this Plug only if you want runtime access on the app's HTTP port; mount it before body parsers and restart the app once.",
  };
}

export async function resolveRuntime(project: string): Promise<RuntimeTarget> {
  const canonical = await realpath(project);
  const projectId = projectKey(canonical);
  const directory = projectDirectory(canonical);
  const descriptorFile = path.join(directory, "runtime.json");
  if (await exists(descriptorFile)) {
    let d: RuntimeDescriptor;
    try {
      d = await readJson<RuntimeDescriptor>(descriptorFile);
    } catch (error) {
      if (error instanceof AccessError) throw error;
      throw new AccessError(
        "runtime_unavailable",
        "The runtime descriptor is unreadable. Restart the app to republish it.",
        "doctor",
      );
    }
    if (
      d.version !== 1 ||
      d.project !== canonical ||
      d.project_id !== projectId ||
      d.socket !== runtimeSocketPath(canonical) ||
      typeof d.os_pid !== "number"
    )
      throw new AccessError(
        "permission_denied",
        "Runtime descriptor identity is invalid.",
      );
    return {
      kind: "socket",
      project: canonical,
      projectId,
      socketPath: d.socket,
    };
  }
  const file = path.join(directory, "phoenix.json");
  if (await exists(file)) {
    const config = await readJson<PhoenixConnection>(file);
    if (
      config.version !== 1 ||
      config.project_id !== projectId ||
      typeof config.token_file !== "string" ||
      !path.isAbsolute(config.token_file)
    )
      throw new AccessError(
        "permission_denied",
        "Phoenix connection identity is invalid.",
      );
    return {
      kind: "http",
      project: canonical,
      projectId,
      endpoint: endpoint(config.endpoint),
      tokenFile: config.token_file,
    };
  }
  throw new AccessError(
    "phoenix_not_configured",
    "No Litewave runtime is published for this project. Add the litewave_phoenix dependency to the app and restart it, or run litewave phoenix setup --project PATH for the HTTP transport.",
    "doctor",
  );
}

export async function callPhoenix(
  project: string,
  method: PhoenixTool,
  input: unknown = {},
): Promise<PhoenixResult> {
  if (!Object.hasOwn(phoenixTools, method))
    return runtimeFailure("invalid_request", "Unknown Phoenix tool.");
  const parsed = phoenixTools[method]?.schema.safeParse(input);
  if (!parsed?.success)
    return runtimeFailure(
      "invalid_request",
      "Invalid Phoenix tool or arguments.",
    );
  const mutation = ["project_eval", "execute_sql_query"].includes(method);
  let target: RuntimeTarget;
  try {
    target = await resolveRuntime(project);
    const args = parsed.data as Record<string, unknown>;
    const body =
      method === "phoenix_health"
        ? undefined
        : JSON.stringify({
            ...args,
            method,
            project_id: target.projectId,
            request_id: args.request_id ?? randomUUID(),
          });
    if (body && Buffer.byteLength(body) > 65_536)
      return runtimeFailure(
        "request_too_large",
        "Runtime requests must fit within 64 KiB.",
      );
    const headers: Record<string, string> = body
      ? { "content-type": "application/json" }
      : {};
    if (target.kind === "http")
      headers.authorization = `Bearer ${await token(target.tokenFile)}`;
    const response = await requestJson(
      target.kind === "socket"
        ? { socketPath: target.socketPath, path: "/litewave/runtime" }
        : { url: target.endpoint },
      {
        method: body ? "POST" : "GET",
        body,
        headers,
        timeoutMs: method === "phoenix_health" ? 2000 : 35_000,
      },
    );
    if (response.status >= 300 && response.status < 400)
      return runtimeFailure(
        "permission_denied",
        "Runtime redirects are not followed.",
        mutation,
      );
    if (response.status < 200 || response.status >= 300)
      return runtimeFailure(
        response.status === 403 ? "permission_denied" : "runtime_http_error",
        `Runtime returned HTTP ${response.status}.`,
        mutation && response.status >= 500,
      );
    if (!response.body)
      return runtimeFailure(
        "invalid_response",
        "Runtime returned an empty response.",
        mutation,
      );
    const result = JSON.parse(response.body) as PhoenixResult;
    if (
      result.project_id !== target.projectId ||
      typeof result.runtime_id !== "string" ||
      result.protocol_version !== 1
    )
      return runtimeFailure(
        "project_mismatch",
        "The responding runtime identity does not match this project.",
        mutation,
      );
    if (method === "phoenix_health" && result.project !== target.project)
      return runtimeFailure(
        "project_mismatch",
        "The responding runtime has a different project directory.",
      );
    return result;
  } catch (error) {
    if (error instanceof AccessError)
      return runtimeFailure(error.code, error.message);
    if (error instanceof TransportError) {
      if (error.code === "response_too_large")
        return runtimeFailure(error.code, error.message, mutation);
      if (!error.sent)
        return runtimeFailure(
          "runtime_unavailable",
          "The runtime socket refused the connection; the app is not running or has not published its runtime yet. Restart the app, then retry.",
        );
      return runtimeFailure(
        "runtime_unavailable",
        mutation
          ? "The runtime response was lost. Inspect runtime_action_status with the original request_id and runtime_id; do not replay automatically."
          : "The runtime response was lost.",
        mutation,
      );
    }
    return runtimeFailure(
      "runtime_unavailable",
      "Phoenix runtime is unavailable. Check installation and whether the app is running.",
    );
  }
}
```

Remove the now-unused `fetch`-era imports (`constants` stays for `token()`).

- [ ] **Step 5: Update src/index.ts exports**

```ts
export {
  callPhoenix,
  setupPhoenix,
  resolveRuntime,
  phoenixTools,
} from "./phoenix.js";
export type {
  PhoenixTool,
  PhoenixResult,
  PhoenixConnection,
  RuntimeTarget,
} from "./phoenix.js";
export { projectKey, runtimeSocketPath, projectDirectory } from "./storage.js";
export type { RuntimeDescriptor } from "./storage.js";
```

Keep the existing exports.

- [ ] **Step 6: Fix compile errors in callers**

`src/cli.ts` and `src/mcp.ts` call `callPhoenix(r, ...)`. Change each to `callPhoenix(r.project, ...)` for now; Task 7 reworks them properly.

- [ ] **Step 7: Run the Node checks**

Run: `npm run check`
Expected: PASS. Both Phoenix tests pass. If the "down" assertion sees `dispatch_occurred: "unknown"`, the `finish` event fired before the connection failed; in that case set `sent = true` on the request's `socket` `connect` event instead of on `finish`.

- [ ] **Step 8: Commit**

```bash
git add src/http.ts src/phoenix.ts src/index.ts src/cli.ts src/mcp.ts test/phoenix.test.ts
git commit -m "Resolve the Phoenix runtime over its Unix socket with HTTP fallback"
```

---

### Task 7: Registration optional for runtime tools in the MCP server and CLI

**Files:**

- Modify: `src/mcp.ts`
- Modify: `src/cli.ts`
- Test: `test/cli-runtime.test.ts`

**Interfaces:**

- Changes: `mcp(context: { project: string; registration: Registration | null })`.
- CLI: `mcp`, `phoenix status`, `phoenix call` work without a registration; `phoenix setup` still requires one; `init` without `--app` uses `app_url` from health.

- [ ] **Step 1: Write the failing test**

```ts
// test/cli-runtime.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  atomicJson,
  projectDirectory,
  projectKey,
  runtimeSocketPath,
  registration,
} from "../src/storage.js";

const run = promisify(execFile);
const cli = fileURLToPath(new URL("../src/cli.js", import.meta.url));

test("runtime tools work without a browser registration; init defaults --app from the runtime", async () => {
  const root = await mkdtemp("/tmp/lw-c-");
  const home = path.join(root, "s");
  const project = root;
  const projectId = projectKey(project);
  const env = { ...process.env, LITEWAVE_HOME: home };
  const server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        protocol_version: 1,
        project_id: projectId,
        project,
        runtime_id: "instance-1",
        capabilities: ["get_docs"],
        app_url: "http://localhost:4123",
        status: "ok",
      }),
    );
  });
  process.env.LITEWAVE_HOME = home;
  const socketPath = runtimeSocketPath(project);
  await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  await atomicJson(path.join(projectDirectory(project), "runtime.json"), {
    version: 1,
    project,
    project_id: projectId,
    runtime_id: "instance-1",
    os_pid: process.pid,
    socket: socketPath,
    started_at: new Date().toISOString(),
    capabilities: ["get_docs"],
  });
  try {
    const status = await run(
      process.execPath,
      [cli, "phoenix", "status", "--project", project],
      { env },
    );
    assert.equal(JSON.parse(status.stdout).runtime_id, "instance-1");

    const client = new Client({ name: "cli-runtime-test", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [cli, "mcp", "--project", project],
      env,
    });
    await client.connect(transport);
    try {
      const listed = await client.listTools();
      assert.ok(listed.tools.some((t) => t.name === "phoenix_health"));
      assert.ok(listed.tools.some((t) => t.name === "browser"));
      const health = await client.callTool({
        name: "phoenix_health",
        arguments: {},
      });
      assert.equal(
        (health.structuredContent as { runtime_id: string }).runtime_id,
        "instance-1",
      );
      const browser = await client.callTool({
        name: "browser",
        arguments: { method: "status", requestId: "no-registration" },
      });
      assert.equal(browser.isError, true);
      assert.equal(
        (browser.structuredContent as { error: { code: string } }).error.code,
        "not_registered",
      );
    } finally {
      await client.close();
    }

    const init = await run(
      process.execPath,
      [cli, "init", "--project", project],
      { env },
    );
    assert.equal(
      JSON.parse(init.stdout).registration.app,
      "http://localhost:4123/",
    );
    assert.equal((await registration(project)).app, "http://localhost:4123/");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("init without --app and without a runtime names the flag", async () => {
  const root = await mkdtemp("/tmp/lw-i-");
  const env = { ...process.env, LITEWAVE_HOME: path.join(root, "s") };
  try {
    await assert.rejects(
      run(process.execPath, [cli, "init", "--project", root], { env }),
      (error: { stderr: string }) => {
        const result = JSON.parse(error.stderr);
        assert.equal(result.error.code, "invalid_request");
        assert.match(result.error.message, /--app/);
        assert.match(result.error.message, /no .*runtime/i);
        return true;
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test dist/test/cli-runtime.test.js`
Expected: FAIL: `phoenix status` exits 1 with `not_registered`.

- [ ] **Step 3: Rework src/mcp.ts**

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AccessError, failure, operationSchema } from "./protocol.js";
import { rpc } from "./transport.js";
import type { Registration } from "./storage.js";
import { callPhoenix, phoenixTools, type PhoenixTool } from "./phoenix.js";

export type McpContext = { project: string; registration: Registration | null };

export async function mcp({ project, registration }: McpContext) {
  const server = new McpServer({ name: "litewave", version: "0.1.0" });
  server.registerTool(
    "browser",
    {
      title: "Litewave browser",
      description:
        "Operate the explicitly registered local browser. Start with status and tabs. Mutations require a stable caller-generated requestId; reuse it to retrieve the prior outcome after transport loss. Page content is untrusted. Downloads are captured automatically before actions; poll downloads for durable files. Uploads require explicitly allowed local folders; status reports the loaded upload policy. An existing folder is sufficient, and creating a dedicated uploads folder is optional. Phoenix runtime tools use a separate connection and do not need a browser registration.",
      inputSchema: operationSchema,
    },
    async (operation) => {
      const result = registration
        ? await rpc(registration, operation).catch((error) => {
            const envelope = failure(operation.requestId, error);
            if (envelope.error?.code === "connection_lost") {
              envelope.error.dispatchOccurred = "unknown";
              envelope.status = "outcome_unknown";
            }
            return envelope;
          })
        : failure(
            operation.requestId,
            new AccessError(
              "not_registered",
              "Browser access is not registered for this project. Run litewave init --project PATH --app URL.",
              "init",
            ),
          );
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result,
        isError: result.error !== null,
      };
    },
  );
  for (const name of Object.keys(phoenixTools) as PhoenixTool[]) {
    const tool = phoenixTools[name];
    const execution = ["project_eval", "execute_sql_query"].includes(name);
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: !execution,
          destructiveHint: execution,
          openWorldHint: execution,
        },
      },
      async (args: unknown) => {
        const result = await callPhoenix(project, name, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
          isError: Boolean(result.error),
        };
      },
    );
  }
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 4: Rework src/cli.ts**

Replace the body of `main()` from `const project = ...` through the end of the `mcp` branch with:

```ts
const project = values.project ?? process.cwd();
const command = positionals.join(" ");
const optionalRegistration = () =>
  registration(project).catch((error: unknown) => {
    if (error instanceof AccessError && error.code === "not_registered")
      return null;
    throw error;
  });
if (command === "init") {
  let app = values.app;
  if (!app) {
    const health = await callPhoenix(project, "phoenix_health");
    if (typeof health.app_url === "string") app = health.app_url;
  }
  if (!app)
    throw new AccessError(
      "invalid_request",
      "--app URL is required: no Litewave runtime reported an application URL for this project.",
    );
  const r = await register(project, app, values["upload-root"]);
  console.log(
    JSON.stringify(
      {
        registration: publicRegistration(r),
        uploads: uploadPolicy(r),
        mcpServers: {
          litewave: {
            command: process.execPath,
            args: [
              fileURLToPath(import.meta.url),
              "mcp",
              "--project",
              r.project,
            ],
            ...(process.env.LITEWAVE_HOME
              ? { env: { LITEWAVE_HOME: process.env.LITEWAVE_HOME } }
              : {}),
          },
        },
      },
      null,
      2,
    ),
  );
  return;
}
if (command.startsWith("phoenix ")) {
  const result =
    command === "phoenix setup"
      ? await setupPhoenix(await registration(project))
      : command === "phoenix status"
        ? await callPhoenix(project, "phoenix_health")
        : command === "phoenix call"
          ? await callPhoenix(
              project,
              values.tool as PhoenixTool,
              JSON.parse(values.json ?? "{}"),
            )
          : (() => {
              throw new AccessError(
                "invalid_request",
                "Unknown Phoenix command.",
              );
            })();
  console.log(JSON.stringify(result, null, 2));
  if ("error" in result && result.error) process.exitCode = 1;
  return;
}
if (command === "mcp") {
  await mcp({ project, registration: await optionalRegistration() });
  return;
}
const r = await registration(project);
```

The remaining browser commands after `const r = await registration(project);` are unchanged. Update `HELP`: the `init` line becomes `litewave init --project PATH [--app URL] [--upload-root PATH ...]` and add below the command list:

```
--app may be omitted when the project's Phoenix app is running with the
litewave_phoenix dependency; init then reads the app URL from the runtime.
Runtime commands (mcp, phoenix status, phoenix call) need no registration.
```

- [ ] **Step 5: Run the Node checks**

Run: `npm run check`
Expected: PASS, including both new CLI tests.

- [ ] **Step 6: Commit**

```bash
git add src/mcp.ts src/cli.ts test/cli-runtime.test.ts
git commit -m "Serve runtime tools without a browser registration and default init app URL from the runtime"
```

---

### Task 8: End-to-end bridge test over the real Elixir socket

**Files:**

- Modify: `test/phoenix-bridge.integration.mjs`
- Create: `packages/phoenix/test/socket_test.exs`
- Modify: `packages/phoenix/test/http_test.exs`

**Interfaces:**

- Consumes: env `LITEWAVE_FIXTURE_TRANSPORT` = `socket` | `http`; `LITEWAVE_FIXTURE_PROJECT`; for `http` also `LITEWAVE_FIXTURE_DIRECTORY`, `LITEWAVE_FIXTURE_TOKEN_FILE`, `LITEWAVE_FIXTURE_ORIGIN`; for `socket`, `LITEWAVE_HOME` set to the listener's home.

- [ ] **Step 1: Rewrite the bridge script for both transports**

```js
// test/phoenix-bridge.integration.mjs
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callPhoenix, resolveRuntime } from "../dist/src/phoenix.js";
import { atomicJson, projectKey } from "../dist/src/storage.js";
import { mcp } from "../dist/src/mcp.js";

const transportKind = process.env.LITEWAVE_FIXTURE_TRANSPORT ?? "http";
const project = process.env.LITEWAVE_FIXTURE_PROJECT;
const registration =
  transportKind === "http"
    ? {
        version: 1,
        id: "http-fixture",
        project,
        app: process.env.LITEWAVE_FIXTURE_ORIGIN,
        directory: process.env.LITEWAVE_FIXTURE_DIRECTORY,
        token: "unused-browser-token",
        socket: path.join(
          process.env.LITEWAVE_FIXTURE_DIRECTORY,
          "absent-browser.sock",
        ),
        origins: [],
        uploadRoots: [],
      }
    : null;

if (process.argv.includes("--mcp-server")) {
  await mcp({ project, registration });
} else {
  if (transportKind === "http") {
    await atomicJson(path.join(registration.directory, "phoenix.json"), {
      version: 1,
      endpoint: registration.app + "/litewave/runtime",
      token_file: process.env.LITEWAVE_FIXTURE_TOKEN_FILE,
      project_id: projectKey(project),
    });
  }
  const target = await resolveRuntime(project);
  assert.equal(target.kind, transportKind);
  const health = await callPhoenix(project, "phoenix_health");
  assert.equal(health.project_id, projectKey(project), JSON.stringify(health));
  assert.equal(health.transport, transportKind);
  assert.equal(health.sql_mode, "disabled");
  assert.ok(health.capabilities.includes("project_eval"));
  for (let attempt = 0; attempt < 3; attempt++) {
    const client = new Client({
      name: "litewave-runtime-test",
      version: "1.0.0",
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), "--mcp-server"],
      env: process.env,
    });
    try {
      await client.connect(transport);
      const listed = await client.listTools();
      for (const name of [
        "browser",
        "get_docs",
        "get_source_location",
        "get_logs",
        "project_eval",
        "execute_sql_query",
        "phoenix_health",
        "runtime_action_status",
      ])
        assert.ok(
          listed.tools.some((t) => t.name === name),
          name,
        );
      const liveHealth = await client.callTool({
        name: "phoenix_health",
        arguments: {},
      });
      assert.equal(liveHealth.structuredContent.runtime_id, health.runtime_id);
      const evaluated = await client.callTool({
        name: "project_eval",
        arguments: {
          code: 'IO.puts("bridge output"); Enum.sum(arguments)',
          arguments: [10, 20],
          runtime_id: health.runtime_id,
          request_id: `bridge-eval-${transportKind}`,
        },
      });
      assert.equal(
        evaluated.structuredContent.result.text,
        "30",
        JSON.stringify(evaluated),
      );
      assert.equal(evaluated.structuredContent.stdout, "bridge output\n");
      const docs = await client.callTool({
        name: "get_docs",
        arguments: { reference: "String.split/2" },
      });
      assert.equal(docs.isError, false, JSON.stringify(docs));
      const source = await client.callTool({
        name: "get_source_location",
        arguments: { reference: "Litewave.TestDocumented.greet/1" },
      });
      assert.match(source.structuredContent.result.path, /documented\.ex$/);
      const old = await client.callTool({
        name: "project_eval",
        arguments: {
          code: 'raise "must not run"',
          runtime_id: "old-runtime",
          request_id: "stale",
        },
      });
      assert.equal(old.structuredContent.error.code, "runtime_changed");
      const browser = await client.callTool({
        name: "browser",
        arguments: { method: "status", requestId: "browser-down" },
      });
      assert.equal(browser.isError, true);
      if (transportKind === "socket")
        assert.equal(browser.structuredContent.error.code, "not_registered");
      assert.equal(
        (await client.callTool({ name: "phoenix_health", arguments: {} }))
          .isError,
        false,
      );
    } finally {
      await client.close();
    }
  }
  console.log(`Phoenix MCP bridge passed over ${transportKind}`);
}
```

- [ ] **Step 2: Update http_test.exs for the key identity**

In `packages/phoenix/test/http_test.exs`:

- In `setup`, remove `project_id: "http-fixture"` from `Litewave.init(...)` so it defaults to the key.
- In the first test, replace `%{"project_id" => "http-fixture"}` with `%{"project_id" => project_id}` and add `assert project_id == Litewave.Paths.key(ctx.config.project)`.
- In the bridge test, add `{"LITEWAVE_FIXTURE_TRANSPORT", "http"}` to `env` and change the final assertion to `assert output =~ "Phoenix MCP bridge passed over http"`.
- Ensure `LITEWAVE_HOME` in that test points somewhere private and unused, so `resolveRuntime` finds no descriptor: add `{"LITEWAVE_HOME", Path.join(ctx.directory, "home")}` to `env`, and make the Node side of `phoenix.json` live under that home by writing it to `Path.join([ctx.directory, "home", "projects", Litewave.Paths.key(ctx.config.project)])`. Pass that directory as `LITEWAVE_FIXTURE_DIRECTORY` (create it with `File.mkdir_p!` and `File.chmod!(…, 0o700)`; also `File.chmod!(Path.join(ctx.directory, "home"), 0o700)` and the `projects` directory).

- [ ] **Step 3: Write socket_test.exs**

```elixir
# packages/phoenix/test/socket_test.exs
defmodule Litewave.SocketTest do
  use ExUnit.Case, async: false

  setup do
    home = "/tmp/lw-b-#{System.unique_integer([:positive])}"
    File.mkdir_p!(home)
    on_exit(fn -> File.rm_rf!(home) end)
    config = Litewave.Config.socket(environment: :test, allow_eval: true)
    pid = start_supervised!({Litewave.Listener, home: home, config: config, name: nil})
    assert %{status: :listening} = Litewave.Listener.info(pid)
    %{home: home, config: config}
  end

  test "the real Node library and MCP bridge work over the socket without registration or token",
       ctx do
    script = Path.expand("../../test/phoenix-bridge.integration.mjs")
    node = System.get_env("LITEWAVE_NODE_EXECUTABLE") || System.find_executable("node")

    assert File.regular?(Path.expand("../../dist/src/phoenix.js")),
           "Run npm run build in the repository root before the bridge integration test."

    {output, exit_code} =
      System.cmd(node, [script],
        env: [
          {"LITEWAVE_HOME", ctx.home},
          {"LITEWAVE_FIXTURE_TRANSPORT", "socket"},
          {"LITEWAVE_FIXTURE_PROJECT", ctx.config.project}
        ],
        stderr_to_stdout: true
      )

    assert exit_code == 0, output
    assert output =~ "Phoenix MCP bridge passed over socket"
  end
end
```

- [ ] **Step 4: Build Node and run both suites**

Run: `npm run check && cd packages/phoenix && mix precommit`
Expected: PASS. The http bridge test and the socket bridge test both print their transport.

- [ ] **Step 5: Commit**

```bash
git add test/phoenix-bridge.integration.mjs packages/phoenix/test
git commit -m "Exercise the MCP bridge end to end over the runtime socket and the HTTP Plug"
```

---

### Task 9: Package README install section and CHANGELOG entry

**Files:**

- Modify: `packages/phoenix/README.md` (Install section only; the full rewrite is plan 2)
- Create: `CHANGELOG.md`
- Create: `packages/phoenix/CHANGELOG.md`

- [ ] **Step 1: Replace the "Install from the Litewave checkout" section**

Replace that section of `packages/phoenix/README.md` with:

````markdown
## Install

Add the development-only dependency and restart your app:

```elixir
{:litewave_phoenix, "~> 0.1", only: :dev}
```

That is the whole install. At boot in `:dev`, the package publishes its runtime
tools on a private Unix socket under `~/.litewave` (or `LITEWAVE_HOME`). No
port, token, or endpoint change is needed. Docs, source locations, logs, and
health are enabled by default. To enable evaluation and writable SQL:

```elixir
# config/dev.exs
config :litewave_phoenix,
  allow_eval: true,
  allow_sql: true,
  repos: [MyApp.Repo]
```

Then, from any directory, connect the Litewave CLI or MCP bridge to the project:

```sh
litewave phoenix status --project /absolute/path/to/app
litewave mcp --project /absolute/path/to/app
```

Set `enabled: false` in the same config to turn the socket off.

### Alternative: HTTP on the app port

If you prefer the runtime on your app's HTTP port, run
`litewave phoenix setup --project PATH` and mount the printed `plug Litewave`
line in your endpoint before `Plug.Parsers`. This transport checks loopback
peer, Host, Origin, and a private token. The socket transport does not need
these because a filesystem socket is unreachable from a web page.
````

Leave the rest of the README for plan 2.

- [ ] **Step 2: Create both CHANGELOGs**

```markdown
# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Runtime tools are published over a private Unix domain socket at app boot.
  The Node bridge finds the socket from the project directory alone.
- `litewave init` reads the application URL from a running runtime when `--app`
  is omitted.
- `litewave mcp`, `litewave phoenix status`, and `litewave phoenix call` no
  longer require a browser registration.

### Changed

- The runtime protocol identifies a project by the project key derived from its
  canonical path, on both transports.
- The endpoint Plug is now the alternative transport; the socket is the default.
```

Write the same content to `packages/phoenix/CHANGELOG.md` with the Node-specific bullets removed.

- [ ] **Step 3: Format and commit**

Run: `npm run format && npm run check`
Expected: PASS.

```bash
git add packages/phoenix/README.md CHANGELOG.md packages/phoenix/CHANGELOG.md
git commit -m "Document the socket install path and start the changelogs"
```

---

## Self-review notes

- Spec 4.1 listener: Task 3. 4.2 path: Tasks 1 and 5. 4.3 descriptor and stale handling: Task 3. 4.4 identity: Tasks 1, 6. 4.5 no token on socket: Tasks 3, 6 (asserted). 4.6 config from env and `enabled`: Tasks 2, 4. 4.7 app_url: Tasks 4, 7. 4.8 Bandit runtime dep: Task 3. 5.1 resolution and `node:http`: Task 6. 5.2 registration optional: Task 7. 5.3 init default: Task 7. Section 8 tests: Tasks 3, 4, 6, 7, 8.
- Names used across tasks: `Litewave.Paths.for_project/2`, `Litewave.Handler.handle/2`, `Litewave.Handler.respond/3`, `Litewave.Handler.capabilities/1`, `Litewave.Config.socket/1`, `Litewave.Listener.info/1`, `projectKey`, `projectDirectory`, `runtimeSocketPath`, `resolveRuntime`, `callPhoenix(project, …)`, `mcp({ project, registration })`. Each is defined before first use.
- Review Focus items 1 and 2 are pinned in Task 6's socket test, item 3 in Task 3's last test, item 4 in Task 7's second test, item 5 in Task 4's app_url test.
