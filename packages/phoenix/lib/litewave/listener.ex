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
            %{
              status: :listening,
              server: server,
              socket: paths.socket,
              descriptor: paths.descriptor,
              reason: nil
            }

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

    %{
      status: :disabled,
      server: nil,
      socket: paths.socket,
      descriptor: paths.descriptor,
      reason: reason
    }
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
