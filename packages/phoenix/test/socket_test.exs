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
