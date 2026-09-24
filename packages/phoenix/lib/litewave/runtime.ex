defmodule Litewave.Runtime do
  @moduledoc false
  use GenServer

  alias Litewave.Capture
  alias Litewave.Output

  @max_actions 512
  @max_running 8

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)
  def identity, do: GenServer.call(__MODULE__, :identity)
  def status(project, request_id), do: GenServer.call(__MODULE__, {:status, project, request_id})

  def execute(operation, config),
    do: GenServer.call(__MODULE__, {:execute, operation, config}, 35_000)

  @impl true
  def init(_) do
    {:ok,
     %{
       id: Base.url_encode64(:crypto.strong_rand_bytes(24), padding: false),
       actions: %{},
       running: %{}
     }}
  end

  @impl true
  def handle_call(:identity, _from, state), do: {:reply, state.id, state}

  def handle_call({:status, project, request_id}, _from, state) do
    result =
      case state.actions[{project, request_id}] do
        nil ->
          error(
            "request_not_found",
            "No request with that ID is recorded in this runtime.",
            false
          )

        %{result: nil} ->
          %{status: "running", result: nil, error: nil}

        %{result: result} ->
          result
      end

    {:reply, result, state}
  end

  def handle_call({:execute, operation, config}, from, state) do
    method = operation["method"]
    mutation? = method in ["project_eval", "execute_sql_query"]
    key = {config.project_id, operation["request_id"]}
    hash = :crypto.hash(:sha256, :erlang.term_to_binary(operation, [:deterministic]))
    existing = if mutation?, do: state.actions[key]

    cond do
      mutation? and operation["runtime_id"] != state.id ->
        {:reply,
         error(
           "runtime_changed",
           "Use phoenix_health to inspect the current runtime. Old execution requests are never replayed across a restart.",
           false
         ), state}

      existing && existing.hash != hash ->
        {:reply,
         error("request_id_conflict", "Request ID already has different arguments.", false),
         state}

      existing ->
        {:reply, existing.result || %{status: "running", result: nil, error: nil}, state}

      map_size(state.running) >= @max_running ->
        {:reply, error("runtime_busy", "Too many runtime operations are running.", false), state}

      mutation? and map_size(state.actions) >= @max_actions ->
        {:reply,
         error(
           "history_full",
           "Runtime execution history is full; IDs are not evicted or replayed. Read-only tools remain available.",
           false
         ), state}

      true ->
        {:ok, capture} = Capture.start(div(config.max_output_bytes, 2))
        timeout = min(Map.get(operation, "timeout", config.timeout), config.timeout)

        task =
          Task.Supervisor.async_nolink(Litewave.TaskSupervisor, fn ->
            Logger.metadata(litewave_runtime: true)
            Process.group_leader(self(), capture)
            Litewave.Tools.dispatch(method, operation, config)
          end)

        timer = Process.send_after(self(), {:timeout, task.ref}, timeout)

        entry = %{
          task: task,
          from: from,
          capture: capture,
          timer: timer,
          key: key,
          mutation?: mutation?,
          config: config
        }

        actions =
          if mutation?,
            do: Map.put(state.actions, key, %{hash: hash, result: nil}),
            else: state.actions

        {:noreply, %{state | running: Map.put(state.running, task.ref, entry), actions: actions}}
    end
  end

  @impl true
  def handle_info({ref, result}, state) when is_reference(ref) do
    Process.demonitor(ref, [:flush])
    complete(state, ref, result)
  end

  def handle_info({:DOWN, ref, :process, _pid, reason}, state) do
    case state.running[ref] do
      nil ->
        {:noreply, state}

      entry ->
        detail = Output.inspect_value(reason, div(entry.config.max_output_bytes, 2))

        result =
          error(
            "execution_failed",
            "Execution exited. Earlier side effects may have occurred.",
            if(entry.mutation?, do: "unknown", else: false)
          )

        complete(
          state,
          ref,
          Map.put(result, :result, %{exception: detail.text, truncated: detail.truncated})
        )
    end
  end

  def handle_info({:timeout, ref}, state) do
    case state.running[ref] do
      nil ->
        {:noreply, state}

      entry ->
        Task.shutdown(entry.task, :brutal_kill)

        complete(
          state,
          ref,
          error(
            "execution_timeout",
            "Execution timed out. Stopping the task does not undo side effects or stop processes it spawned.",
            if(entry.mutation?, do: "unknown", else: false)
          )
        )
    end
  end

  defp complete(state, ref, result) do
    case Map.pop(state.running, ref) do
      {nil, _} ->
        {:noreply, state}

      {entry, running} ->
        Process.cancel_timer(entry.timer)
        io = Capture.contents(entry.capture)
        GenServer.stop(entry.capture)

        reply =
          case result do
            {:ok, value} -> %{status: "ok", result: value, error: nil}
            {:error, code, message} -> error(code, message, false)
            %{} = value -> value
          end
          |> Map.put(:stdout, io.text)
          |> Map.put(:stdout_truncated, io.truncated)

        GenServer.reply(entry.from, reply)

        actions =
          if entry.mutation?,
            do: put_in(state.actions, [entry.key, :result], reply),
            else: state.actions

        {:noreply, %{state | actions: actions, running: running}}
    end
  end

  def error(code, message, dispatch) do
    %{
      status: if(dispatch == "unknown", do: "outcome_unknown", else: "error"),
      result: nil,
      error: %{code: code, message: message, dispatch_occurred: dispatch}
    }
  end
end
