defmodule Litewave do
  @moduledoc """
  Development-only Phoenix runtime access for the Litewave CLI and MCP bridge.

  Adding `{:litewave_phoenix, "~> 0.1", only: :dev}` to your dependencies is
  the whole integration: at boot in `:dev` the application publishes its
  runtime tools on a private Unix socket (see `Litewave.Listener`). This
  module is the **alternative** transport, a Plug that serves the same tools
  on your application's HTTP port.

  ## Mounting the Plug

  Run `litewave phoenix setup --project PATH` once (after `litewave init`) and
  mount the printed line in your endpoint **before** `Plug.Parsers`:

      if Mix.env() == :dev do
        plug Litewave,
          project: "/absolute/path/to/app",
          endpoint: "http://localhost:4000",
          token_file: "/Users/you/.litewave/projects/<key>/phoenix-token",
          allow_eval: false,
          allow_sql: false
      end

  Or resolve everything from the CLI's registration:

      plug Litewave, registration: "/absolute/path/to/app"

  ## Options

  See `Litewave.Config.new/1` for every option. `project_id` is optional and
  defaults to the project key derived from the canonical project path; the
  Node bridge derives the same key. Options set under
  `config :litewave_phoenix` apply to this Plug as defaults; the Plug's own
  arguments win.

  ## What the Plug checks

  Every request to `/litewave/runtime` must come from a loopback peer, carry
  the exact configured `Host` and (if present) `Origin`, and present the
  token from `token_file` as a Bearer token. Other paths pass through
  untouched. Production configuration is refused at `init/1`.

  `allow_eval: true` executes arbitrary Elixir in your application and
  `allow_sql: true` runs **read-write** SQL through your Ecto repositories.
  Neither is a sandbox.
  """
  @behaviour Plug
  import Plug.Conn
  alias Litewave.{Handler, Runtime}

  @impl true
  @spec init(keyword()) :: Litewave.Config.t()
  def init(opts), do: Litewave.Config.new(opts)

  @impl true
  @spec call(Plug.Conn.t(), Litewave.Config.t()) :: Plug.Conn.t()
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
