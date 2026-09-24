defmodule Litewave.SocketPlug do
  @moduledoc false
  @behaviour Plug
  import Plug.Conn

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
    conn
    |> put_resp_content_type("application/json")
    |> send_resp(404, Jason.encode!(%{error: %{code: "not_found", message: "Unknown path."}}))
    |> halt()
  end
end
