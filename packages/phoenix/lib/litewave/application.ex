defmodule Litewave.Application do
  @moduledoc false
  use Application

  @impl true
  def start(_type, _args) do
    children =
      if Litewave.Config.environment() in [:dev, :test] do
        [
          {Task.Supervisor, name: Litewave.TaskSupervisor},
          Litewave.Logs,
          Litewave.Runtime
        ]
      else
        []
      end

    Supervisor.start_link(children, strategy: :one_for_all, name: Litewave.Supervisor)
  end
end
