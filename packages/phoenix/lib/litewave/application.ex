defmodule Litewave.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    enabled = Application.get_env(:litewave_phoenix, :enabled, true)
    children = children(enabled, Litewave.Config.environment())
    Supervisor.start_link(children, strategy: :one_for_all, name: Litewave.Supervisor)
  end

  # Public so tests can assert the child list without restarting the app.
  # A production host gets no children at all: nothing can publish a socket.
  @doc false
  def children(enabled, environment) when environment in [:dev, :test] do
    [
      {Task.Supervisor, name: Litewave.TaskSupervisor},
      Litewave.Logs,
      Litewave.Runtime
    ] ++ if(enabled, do: [Litewave.Listener], else: [])
  end

  def children(_enabled, _environment), do: []
end
