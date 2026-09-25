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
    assert (File.stat!(Path.dirname(ctx.paths.descriptor)).mode &&& 0o777) == 0o700

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

  test "tightens a loose home and projects directory before listening", ctx do
    File.chmod!(ctx.home, 0o755)
    pid = start(ctx)
    assert %{status: :listening} = Listener.info(pid)
    assert (File.stat!(ctx.home).mode &&& 0o777) == 0o700
    assert (File.stat!(Path.join(ctx.home, "projects")).mode &&& 0o777) == 0o700
  end

  test "names the directory it cannot secure", ctx do
    File.write!(Path.join(ctx.home, "projects"), "not a directory")

    log =
      capture_log(fn ->
        pid = start(ctx)
        assert %{status: :disabled, reason: reason} = Listener.info(pid)
        assert reason =~ Path.join(ctx.home, "projects")
      end)

    assert log =~ "Litewave runtime socket is unavailable"
  end

  test "stops the bound server and removes the socket if starting fails after binding", ctx do
    File.mkdir_p!(ctx.paths.descriptor)

    log =
      capture_log(fn ->
        pid = start(ctx)
        assert %{status: :disabled, reason: reason} = Listener.info(pid)
        assert is_binary(reason)
      end)

    assert log =~ "Litewave runtime socket is unavailable"
    refute File.exists?(ctx.paths.socket)

    assert {:error, _} =
             :gen_tcp.connect({:local, ctx.paths.socket}, 0, [:local, active: false], 500)
  end

  test "does not delete a socket path it cannot prove is dead", ctx do
    File.mkdir_p!(Path.dirname(ctx.paths.socket))
    File.write!(ctx.paths.socket, "not a socket")

    log =
      capture_log(fn ->
        pid = start(ctx)
        assert %{status: :disabled, reason: reason} = Listener.info(pid)
        assert reason =~ "cannot probe existing socket"
      end)

    assert log =~ "Litewave runtime socket is unavailable"
    assert File.read!(ctx.paths.socket) == "not a socket"
  end

  test "unknown paths get the JSON error envelope with no-store", ctx do
    start(ctx)
    response = Req.get!("http://localhost/other", unix_socket: ctx.paths.socket, retry: false)
    assert response.status == 404
    assert Req.Response.get_header(response, "cache-control") == ["no-store"]
    assert %{"error" => %{"code" => "not_found", "dispatch_occurred" => false}} = response.body
  end

  test "sweeps abandoned partial descriptors before publishing", ctx do
    directory = Path.dirname(ctx.paths.descriptor)
    File.mkdir_p!(directory)
    partial = ctx.paths.descriptor <> ".123.partial"
    File.write!(partial, "{")
    start(ctx)
    refute File.exists?(partial)
    assert File.exists?(ctx.paths.descriptor)
  end

  test "reports disabled and removes its files when the bound server exits", ctx do
    listener = start(ctx)
    %{server: server} = :sys.get_state(listener)
    # The acceptor pool supervisor logs its own crash report as it dies; wait
    # for every process in the tree to be gone so no such line can land after
    # capture_log's window has closed.
    refs = server |> collect_pids() |> Enum.map(&Process.monitor/1)

    log =
      capture_log(fn ->
        Process.exit(server, :kill)
        eventually(fn -> Listener.info(listener).status == :disabled end)
        for ref <- refs, do: assert_receive({:DOWN, ^ref, _, _, _}, 1_000)
      end)

    assert %{status: :disabled, reason: "listener exited: killed"} = Listener.info(listener)
    refute File.exists?(ctx.paths.socket)
    refute File.exists?(ctx.paths.descriptor)
    assert log =~ "listener exited"
  end

  # A failed start still reports, through info/1, the socket and descriptor
  # paths it derived. A live conflicting socket is the one start failure that
  # is provable without racing the filesystem; the listener gives the same
  # guarantee for exceptions raised after the paths are derived.
  test "info names the paths it derived even when starting fails", ctx do
    start(ctx)
    {second, _log} = with_log(fn -> start(ctx, id: :second) end)
    info = Listener.info(second)
    assert info.status == :disabled
    assert info.reason =~ "another runtime already serves"
    assert info.socket == ctx.paths.socket
    assert info.descriptor == ctx.paths.descriptor
  end

  # The whole live tree under `pid`, `pid` included, so every one of its
  # processes can be monitored and waited for on teardown.
  defp collect_pids(pid) do
    children =
      pid
      |> Supervisor.which_children()
      |> Enum.flat_map(fn
        {_id, child, :supervisor, _modules} when is_pid(child) -> collect_pids(child)
        {_id, child, _type, _modules} when is_pid(child) -> [child]
        _ -> []
      end)

    [pid | children]
  end

  defp eventually(fun, attempts \\ 100) do
    cond do
      fun.() ->
        :ok

      attempts > 0 ->
        Process.sleep(20)
        eventually(fun, attempts - 1)

      true ->
        flunk("condition not met within 2 s")
    end
  end
end
