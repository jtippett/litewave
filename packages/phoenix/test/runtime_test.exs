defmodule Litewave.RuntimeTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn
  alias Litewave.Runtime

  setup do
    directory =
      Path.join(System.tmp_dir!(), "litewave-test-#{System.unique_integer([:positive])}")

    File.mkdir_p!(directory)
    token_file = Path.join(directory, "token")
    token = Base.encode16(:crypto.strong_rand_bytes(32), case: :lower)
    File.write!(token_file, token)
    File.chmod!(token_file, 0o600)
    project = File.cwd!()

    opts = [
      project: project,
      project_id: directory,
      endpoint: "http://localhost:4700",
      token_file: token_file,
      environment: :test,
      allow_eval: true,
      allow_sql: true
    ]

    config = Litewave.init(opts)
    on_exit(fn -> File.rm_rf!(directory) end)
    %{config: config, token: token, opts: opts, directory: directory}
  end

  test "uses the host Mix environment and rejects a production host", ctx do
    previous = Mix.env()
    on_exit(fn -> Mix.env(previous) end)
    assert Litewave.Config.environment() == :test
    Mix.env(:prod)
    assert Litewave.Config.environment() == :prod
    assert_raise ArgumentError, ~r/development-only/, fn -> Litewave.init(ctx.opts) end
    Mix.env(previous)
  end

  test "authenticated health exposes identity, capabilities, and SQL policy", ctx do
    response = request(ctx, :get)
    assert response.status == 200
    body = Jason.decode!(response.resp_body)
    assert body["runtime_id"] == Runtime.identity()
    assert body["project_id"] == ctx.config.project_id
    assert body["sql_mode"] == "read_write"
    assert "project_eval" in body["capabilities"]
    refute response.resp_body =~ ctx.token
    assert get_resp_header(response, "cache-control") == ["no-store"]
  end

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

  test "project_id defaults to the project key when not supplied", ctx do
    config = Litewave.init(Keyword.delete(ctx.opts, :project_id))
    assert config.project_id == Litewave.Paths.key(config.project)
    assert config.transport == :endpoint
  end

  test "rejects remote peer, forged host/origin, missing token, and public token files", ctx do
    for transform <- [
          &%{&1 | remote_ip: {10, 1, 1, 1}},
          &%{&1 | req_headers: [{"host", "attacker.test:4700"}]},
          &put_req_header(&1, "origin", "https://attacker.test"),
          &delete_req_header(&1, "authorization"),
          &put_req_header(&1, "authorization", "Bearer invalid")
        ] do
      assert request(ctx, :get, %{}, transform).status == 403
    end

    File.chmod!(ctx.config.token_file, 0o644)
    assert request(ctx, :get).status == 403
  end

  test "rejects production configuration and leaves ordinary application responses untouched",
       ctx do
    assert_raise ArgumentError, ~r/development-only/, fn ->
      Litewave.init(Keyword.put(ctx.opts, :environment, :prod))
    end

    assert_raise ArgumentError, ~r/must be a boolean/, fn ->
      Litewave.init(Keyword.put(ctx.opts, :allow_eval, "false"))
    end

    ordinary =
      conn(:get, "/account") |> put_resp_header("content-security-policy", "default-src 'self'")

    assert Litewave.call(ordinary, ctx.config) == ordinary
  end

  test "invalid requests and mismatched project identity are rejected before execution", ctx do
    assert request(ctx, :post, %{method: "project_eval", code: "send(self(), :bad)"}).status ==
             400

    assert request(ctx, :post, %{
             method: "get_docs",
             request_id: "wrong",
             project_id: "other",
             reference: "String"
           }).status == 400

    huge = base_conn(ctx, :post, String.duplicate("x", 70_000)) |> Litewave.call(ctx.config)
    assert huge.status == 413
  end

  test "docs handle modules, functions, defaults, callbacks and unknown references", ctx do
    result = tool(ctx, "get_docs", %{reference: "Litewave.TestDocumented"})
    assert result["status"] == "ok", inspect(result)

    assert tool(ctx, "get_docs", %{reference: "Litewave.TestDocumented"})["result"]["text"] =~
             "documented test module"

    assert tool(ctx, "get_docs", %{reference: "Litewave.TestDocumented.greet/0"})["result"][
             "text"
           ] =~ "Return a greeting"

    assert tool(ctx, "get_docs", %{reference: "c:Litewave.TestDocumented.handle/1"})["result"][
             "text"
           ] =~ "documented callback"

    assert tool(ctx, "get_docs", %{reference: "String.split/2"})["status"] == "ok"

    assert tool(ctx, "get_docs", %{reference: "ModuleThatCannotExist438329"})["error"]["code"] ==
             "docs_not_found"

    assert tool(ctx, "get_docs", %{reference: "System.cmd(\"touch\", [\"bad\"])"})["status"] ==
             "error"
  end

  test "source lookup resolves app and dependency files; symlinks cannot escape roots", ctx do
    source = tool(ctx, "get_source_location", %{reference: "Litewave.TestDocumented.greet/1"})
    assert source["status"] == "ok", inspect(source)
    assert source["result"]["path"] == Path.join(ctx.config.project, "test/support/documented.ex")
    assert is_integer(source["result"]["line"])

    assert tool(ctx, "get_source_location", %{reference: "dep:plug"})["result"]["path"] =~
             "/deps/plug"

    outside = Path.join(ctx.directory, "outside")
    allowed = Path.join(ctx.directory, "allowed")
    File.mkdir!(outside)
    File.mkdir!(allowed)
    File.write!(Path.join(outside, "secret"), "secret")
    File.ln_s!(outside, Path.join(allowed, "link"))

    assert {:error, :outside_roots} =
             Litewave.Source.allowed_path(Path.join(allowed, "link/secret"), [allowed])
  end

  test "evaluation captures bounded Unicode output and supports IEx helpers and arguments", ctx do
    result =
      tool(ctx, "project_eval", %{
        code: "IO.puts(\"hello\"); Enum.sum(arguments)",
        arguments: [2, 3]
      })

    assert result["result"]["text"] == "5"
    assert result["stdout"] == "hello\n"

    assert tool(ctx, "project_eval", %{code: "exports(Litewave.TestDocumented)"})["status"] ==
             "ok"

    result = tool(ctx, "project_eval", %{code: "IO.write(String.duplicate(\"日\", 50_000)); :ok"})
    assert result["stdout_truncated"]
    assert String.valid?(result["stdout"])
    assert byte_size(result["stdout"]) <= div(ctx.config.max_output_bytes, 2)
  end

  test "exceptions and timeouts leave the runtime healthy and expose uncertainty", ctx do
    id = Runtime.identity()
    failed = tool(ctx, "project_eval", %{code: "raise \"expected fixture exception\""})
    assert failed["status"] == "outcome_unknown"
    assert failed["result"]["exception"] =~ "expected fixture exception"
    timeout = tool(ctx, "project_eval", %{code: "Process.sleep(500)", timeout: 10})
    assert timeout["error"]["code"] == "execution_timeout"
    assert timeout["error"]["dispatch_occurred"] == "unknown"
    assert Runtime.identity() == id
    assert tool(ctx, "project_eval", %{code: "1 + 1"})["result"]["text"] == "2"
  end

  test "disabled execution capabilities fail without evaluating", ctx do
    ctx = %{ctx | config: %{ctx.config | allow_eval: false, allow_sql: false}}

    assert tool(ctx, "project_eval", %{code: "raise \"must not run\""})["error"]["code"] ==
             "capability_disabled"

    assert tool(ctx, "execute_sql_query", %{query: "select 1"})["error"]["code"] ==
             "capability_disabled"
  end

  test "duplicate execution IDs do not repeat effects and stale runtimes cannot execute", ctx do
    request_id = unique()

    code =
      "Application.put_env(:litewave_phoenix, :execution_counter, Application.get_env(:litewave_phoenix, :execution_counter, 0) + 1)"

    Application.put_env(:litewave_phoenix, :execution_counter, 0)
    args = %{request_id: request_id, code: code}
    first = tool(ctx, "project_eval", args)
    assert first["status"] == "ok"
    assert tool(ctx, "project_eval", args) == first
    assert Application.get_env(:litewave_phoenix, :execution_counter) == 1

    assert tool(ctx, "project_eval", %{args | code: ":changed"})["error"]["code"] ==
             "request_id_conflict"

    assert tool(ctx, "runtime_action_status", %{action_id: request_id})["result"]["text"] == ":ok"

    assert tool(ctx, "project_eval", %{code: code, runtime_id: "previous-runtime"})["error"][
             "code"
           ] == "runtime_changed"

    assert Application.get_env(:litewave_phoenix, :execution_counter) == 1
  end

  test "log capture provides filtering, continuation, and overflow gaps", ctx do
    for n <- 1..1100, do: Litewave.Logs.record("warning", "fixture-log-#{n}")
    result = tool(ctx, "get_logs", %{cursor: 1, tail: 2, level: "warning", grep: "FIXTURE-LOG"})
    assert result["result"]["gap"]
    assert result["result"]["has_more"]
    assert length(result["result"]["entries"]) == 2
    continued = tool(ctx, "get_logs", %{cursor: result["result"]["next_cursor"], tail: 2})
    assert hd(continued["result"]["entries"])["cursor"] > result["result"]["next_cursor"]
  end

  test "multiple repos require an explicit selection; arbitrary repo names are rejected", ctx do
    ctx = %{ctx | config: %{ctx.config | repos: [Litewave.FirstRepo, Litewave.SecondRepo]}}

    assert tool(ctx, "execute_sql_query", %{query: "select 1"})["error"]["code"] ==
             "repo_required"

    assert tool(ctx, "execute_sql_query", %{query: "select 1", repo: "Unconfigured.Repo"})[
             "error"
           ]["code"] == "repo_not_found"
  end

  test "registration setup resolves the same canonical identity as the Node bridge", ctx do
    previous = System.get_env("LITEWAVE_HOME")
    System.put_env("LITEWAVE_HOME", ctx.directory)

    on_exit(fn ->
      if previous,
        do: System.put_env("LITEWAVE_HOME", previous),
        else: System.delete_env("LITEWAVE_HOME")
    end)

    {:ok, project} = Litewave.Source.canonical(ctx.config.project)
    key = Litewave.Paths.key(project)
    dir = Path.join([ctx.directory, "projects", key])
    File.mkdir_p!(dir)

    File.write!(
      Path.join(dir, "registration.json"),
      Jason.encode!(%{project: project})
    )

    File.write!(
      Path.join(dir, "phoenix.json"),
      Jason.encode!(%{
        project_id: key,
        endpoint: "http://localhost:4700/litewave/runtime",
        token_file: ctx.config.token_file
      })
    )

    config = Litewave.init(registration: project)
    assert config.project_id == key
    refute config.allow_eval
    refute config.allow_sql
    assert config.token_file == ctx.config.token_file
    File.write!(Path.join(dir, "phoenix.json"), Jason.encode!(%{project_id: "different-project"}))

    assert_raise ArgumentError, ~r/missing or mismatched/, fn ->
      Litewave.init(registration: project)
    end
  end

  test "unknown module references cannot grow the atom table" do
    assert Litewave.Introspection.parse_reference("UnknownLitewaveWarmup938475") == :error
    before = :erlang.system_info(:atom_count)

    for n <- 1..100 do
      assert Litewave.Introspection.parse_reference("UnknownLitewaveModule938475#{n}") == :error
    end

    assert :erlang.system_info(:atom_count) - before < 10
  end

  test "real logger events enter the buffer and a reset cursor reports a gap", ctx do
    require Logger
    Logger.warning("litewave-real-logger-fixture")
    Logger.flush()
    result = tool(ctx, "get_logs", %{grep: "litewave-real-logger-fixture"})

    assert Enum.any?(
             result["result"]["entries"],
             &String.contains?(&1["text"], "litewave-real-logger-fixture")
           )

    reset = tool(ctx, "get_logs", %{cursor: 1_000_000, tail: 1})
    assert reset["result"]["gap"]
    assert reset["result"]["reset"]
    assert request(%{ctx | config: %{ctx.config | owner_uid: -1}}, :get).status == 403
  end

  defp tool(ctx, method, args) do
    base = %{
      method: method,
      request_id: unique(),
      runtime_id: Runtime.identity(),
      project_id: ctx.config.project_id
    }

    conn = request(ctx, :post, Map.merge(base, args))
    assert conn.status == 200, conn.resp_body
    Jason.decode!(conn.resp_body)
  end

  defp request(ctx, method, args \\ %{}, transform \\ &Function.identity/1) do
    ctx |> base_conn(method, Jason.encode!(args)) |> transform.() |> Litewave.call(ctx.config)
  end

  defp base_conn(ctx, method, body) do
    conn(method, "http://localhost:4700/litewave/runtime", body)
    |> Map.update!(:req_headers, &[{"host", "localhost:4700"} | &1])
    |> put_req_header("content-type", "application/json")
    |> put_req_header("authorization", "Bearer " <> ctx.token)
  end

  defp unique, do: Integer.to_string(System.unique_integer([:positive]))
end
