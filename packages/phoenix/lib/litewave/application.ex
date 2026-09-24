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
