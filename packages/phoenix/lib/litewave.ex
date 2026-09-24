defmodule Litewave do
  @moduledoc """
  Development-only Phoenix runtime access for Litewave's local CLI/MCP bridge.

  Mount before body parsers with `plug Litewave, project: ..., project_id: ...,
  endpoint: "http://localhost:4000", token_file: ...`. Evaluation and SQL require
  `allow_eval: true` and `allow_sql: true` respectively.
  """
  @behaviour Plug
  import Plug.Conn
  alias Litewave.Runtime

  @methods ~w(get_docs get_source_location get_logs project_eval execute_sql_query)

  @impl true
  def init(opts), do: Litewave.Config.new(opts)

  @impl true
  def call(%{path_info: ["litewave", "runtime"]} = conn, config) do
    with :ok <- authorize(conn, config),
         true <- is_pid(Process.whereis(Runtime)) do
      handle(conn, config)
    else
      _ ->
        respond(
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

  defp handle(%{method: "GET"} = conn, config) do
    capabilities =
      ~w(get_docs get_source_location get_logs) ++
        if(config.allow_eval, do: ["project_eval"], else: []) ++
        if(config.allow_sql, do: ["execute_sql_query"], else: [])

    respond(conn, 200, %{
      protocol_version: 1,
      project_id: config.project_id,
      project: config.project,
      runtime_id: Runtime.identity(),
      environment: config.environment,
      elixir: System.version(),
      otp: System.otp_release(),
      capabilities: capabilities,
      repos: Enum.map(config.repos, &inspect/1),
      sql_mode: if(config.allow_sql, do: "read_write", else: "disabled")
    })
  end

  defp handle(%{method: "POST"} = conn, config) do
    with [content_type] <- get_req_header(conn, "content-type"),
         true <-
           content_type |> String.split(";", parts: 2) |> hd() |> String.trim() ==
             "application/json",
         {:ok, body, conn} <-
           read_body(conn, length: 65_536, read_length: 65_536, read_timeout: 5000),
         {:ok, %{} = args} <- Jason.decode(body),
         :ok <- validate(args, config) do
      result =
        if args["method"] == "runtime_action_status" do
          if args["runtime_id"] == Runtime.identity(),
            do: Runtime.status(config.project_id, args["action_id"]),
            else:
              Runtime.error("runtime_changed", "The recorded runtime is no longer active.", false)
        else
          Runtime.execute(args, config)
        end

      envelope =
        Map.merge(result, %{
          protocol_version: 1,
          project_id: config.project_id,
          runtime_id: Runtime.identity(),
          request_id: args["request_id"]
        })

      respond(conn, 200, bounded(envelope, config.max_output_bytes))
    else
      {:more, _, conn} ->
        respond(conn, 413, Runtime.error("request_too_large", "Request exceeds 64 KiB.", false))

      _ ->
        respond(
          conn,
          400,
          Runtime.error("invalid_request", "Invalid runtime request or project identity.", false)
        )
    end
  end

  defp handle(conn, _config),
    do: respond(conn, 405, Runtime.error("method_not_allowed", "Use GET or POST.", false))

  defp validate(args, config) do
    method = args["method"]

    valid =
      args["project_id"] == config.project_id and
        is_binary(args["request_id"]) and byte_size(args["request_id"]) in 1..200 and
        (method in @methods or method == "runtime_action_status") and
        valid_arguments?(method, args) and
        is_integer(Map.get(args, "timeout", config.timeout)) and
        Map.get(args, "timeout", config.timeout) in 1..30_000

    if valid, do: :ok, else: :error
  end

  defp valid_arguments?(method, args) when method in ["get_docs", "get_source_location"],
    do: is_binary(args["reference"]) and byte_size(args["reference"]) in 1..500

  defp valid_arguments?("project_eval", args),
    do:
      is_binary(args["code"]) and byte_size(args["code"]) <= 32_000 and
        is_list(Map.get(args, "arguments", [])) and is_binary(args["runtime_id"])

  defp valid_arguments?("execute_sql_query", args),
    do:
      is_binary(args["query"]) and byte_size(args["query"]) <= 32_000 and
        is_list(Map.get(args, "arguments", [])) and is_binary(args["runtime_id"])

  defp valid_arguments?("runtime_action_status", args),
    do:
      is_binary(args["runtime_id"]) and is_binary(args["action_id"]) and
        byte_size(args["action_id"]) <= 200

  defp valid_arguments?("get_logs", _args), do: true
  defp valid_arguments?(_, _), do: false

  defp bounded(envelope, limit) do
    encoded = Jason.encode!(envelope)

    if byte_size(encoded) <= limit + 4096 do
      envelope
    else
      Map.merge(envelope, %{
        result: Litewave.Output.inspect_value(envelope.result, div(limit, 2)),
        stdout: Litewave.Output.limit(Map.get(envelope, :stdout, ""), div(limit, 4)).text,
        output_truncated: true
      })
    end
  end

  defp respond(conn, status, value) do
    conn
    |> put_resp_content_type("application/json")
    |> put_resp_header("cache-control", "no-store")
    |> send_resp(status, Jason.encode!(value))
    |> halt()
  end
end
