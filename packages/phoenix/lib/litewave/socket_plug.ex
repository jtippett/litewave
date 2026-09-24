defmodule Litewave.SocketPlug do
  @moduledoc false
  @behaviour Plug

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
    Litewave.Handler.respond(
      conn,
      404,
      Litewave.Runtime.error("not_found", "Unknown path.", false)
    )
  end
end
