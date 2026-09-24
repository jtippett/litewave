defmodule Litewave.HTTPTest do
  use ExUnit.Case, async: false

  setup do
    directory =
      Path.join(System.tmp_dir!(), "litewave-http-#{System.unique_integer([:positive])}")

    File.mkdir_p!(directory)
    token_file = Path.join(directory, "token")
    token = Base.encode16(:crypto.strong_rand_bytes(32), case: :lower)
    File.write!(token_file, token)
    File.chmod!(token_file, 0o600)
    server = start_supervised!({Bandit, plug: Litewave.TestEndpoint, ip: {127, 0, 0, 1}, port: 0})
    {:ok, {_, port}} = ThousandIsland.listener_info(server)
    origin = "http://127.0.0.1:#{port}"

    config =
      Litewave.init(
        project: File.cwd!(),
        endpoint: origin,
        token_file: token_file,
        allow_eval: true
      )

    Application.put_env(:litewave_phoenix, :http_fixture, config)
    on_exit(fn -> File.rm_rf!(directory) end)
    %{directory: directory, token_file: token_file, token: token, origin: origin, config: config}
  end

  test "real HTTP authenticates health and rejects Origin attacks", ctx do
    url = ctx.origin <> "/litewave/runtime"

    assert {:ok, %{status: 200, body: %{"project_id" => project_id}}} =
             Req.get(url, auth: {:bearer, ctx.token}, retry: false)

    assert project_id == Litewave.Paths.key(ctx.config.project)

    assert {:ok, %{status: 403}} =
             Req.get(url,
               auth: {:bearer, ctx.token},
               headers: [origin: "https://attacker.test"],
               retry: false
             )
  end

  test "the real Node library and MCP bridge work against the HTTP adapter without a browser",
       ctx do
    script = Path.expand("../../test/phoenix-bridge.integration.mjs")
    node = System.get_env("LITEWAVE_NODE_EXECUTABLE") || System.find_executable("node")

    assert File.regular?(Path.expand("../../dist/src/phoenix.js")),
           "Run npm run build in the repository root before the bridge integration test."

    home = Path.join(ctx.directory, "home")
    fixture_directory = Path.join([home, "projects", Litewave.Paths.key(ctx.config.project)])
    File.mkdir_p!(fixture_directory)
    File.chmod!(home, 0o700)
    File.chmod!(Path.join(home, "projects"), 0o700)
    File.chmod!(fixture_directory, 0o700)

    {output, exit_code} =
      System.cmd(node, [script],
        env: [
          {"LITEWAVE_HOME", home},
          {"LITEWAVE_FIXTURE_TRANSPORT", "http"},
          {"LITEWAVE_FIXTURE_DIRECTORY", fixture_directory},
          {"LITEWAVE_FIXTURE_TOKEN_FILE", ctx.token_file},
          {"LITEWAVE_FIXTURE_PROJECT", ctx.config.project},
          {"LITEWAVE_FIXTURE_ORIGIN", ctx.origin}
        ],
        stderr_to_stdout: true
      )

    assert exit_code == 0, output
    assert output =~ "Phoenix MCP bridge passed over http"
  end

  test "a restarted adapter rejects old execution identities", ctx do
    old_id = Litewave.Runtime.identity()
    :ok = Supervisor.terminate_child(Litewave.Supervisor, Litewave.Runtime)
    {:ok, _} = Supervisor.restart_child(Litewave.Supervisor, Litewave.Runtime)
    refute Litewave.Runtime.identity() == old_id

    body = %{
      method: "project_eval",
      project_id: ctx.config.project_id,
      request_id: "old-request",
      runtime_id: old_id,
      code: "raise \"must not execute\""
    }

    assert {:ok, %{status: 200, body: %{"error" => %{"code" => "runtime_changed"}}}} =
             Req.post(ctx.origin <> "/litewave/runtime",
               auth: {:bearer, ctx.token},
               json: body,
               retry: false
             )
  end
end
