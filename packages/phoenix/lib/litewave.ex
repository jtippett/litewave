defmodule Litewave do
  @moduledoc """
  Development-only Phoenix runtime access for Litewave's local CLI/MCP bridge.

  Mount before body parsers with `plug Litewave, project: ..., project_id: ...,
  endpoint: "http://localhost:4000", token_file: ...`. Evaluation and SQL require
  `allow_eval: true` and `allow_sql: true` respectively.
  """
  @behaviour Plug
  import Plug.Conn
  alias Litewave.{Handler, Runtime}

  @impl true
  def init(opts), do: Litewave.Config.new(opts)

  @impl true
  def call(%{path_info: ["litewave", "runtime"]} = conn, config) do
    with :ok <- authorize(conn, config),
         true <- is_pid(Process.whereis(Runtime)) do
      Handler.handle(conn, config)
    else
      _ ->
        Handler.respond(
          conn,
          403,
          Runtime.error("permission_denied", "Runtime access denied or unavailable.", false)
        )
    end
  end

  def call(conn, _config), do: conn

  defp authorize(conn, config) do
    origin = URI.to_string(%{config.endpoint | path: nil})

    host =
      if String.contains?(config.endpoint.host, ":"),
        do: "[#{config.endpoint.host}]",
        else: config.endpoint.host

    default_port = if config.endpoint.scheme == "https", do: 443, else: 80

    host_header =
      host <> if(config.endpoint.port == default_port, do: "", else: ":#{config.endpoint.port}")

    with true <- conn.remote_ip in [{127, 0, 0, 1}, {0, 0, 0, 0, 0, 0, 0, 1}],
         true <-
           conn.host == config.endpoint.host and conn.port == config.endpoint.port and
             Atom.to_string(conn.scheme) == config.endpoint.scheme,
         [^host_header] <- get_req_header(conn, "host"),
         origins when origins == [] or origins == [origin] <- get_req_header(conn, "origin"),
         ["Bearer " <> supplied] <- get_req_header(conn, "authorization"),
         {:ok, token} <- Litewave.Config.token(config.token_file, config.owner_uid),
         true <-
           byte_size(supplied) == byte_size(token) and Plug.Crypto.secure_compare(supplied, token) do
      :ok
    else
      _ -> :error
    end
  end
end
