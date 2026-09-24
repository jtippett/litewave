defmodule Litewave.TestEndpoint do
  @moduledoc false
  @behaviour Plug

  @impl true
  def init(opts), do: opts

  @impl true
  def call(conn, _opts),
    do: Litewave.call(conn, Application.fetch_env!(:litewave_phoenix, :http_fixture))
end
