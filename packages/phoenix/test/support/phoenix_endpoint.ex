defmodule Litewave.TestPhoenixEndpoint do
  @moduledoc false
  # Mimics the functions Litewave.AppURL uses to recognise a Phoenix endpoint.
  def __sockets__, do: []
  def url, do: "http://localhost:4123"
  def struct_url, do: URI.parse(url())
end
