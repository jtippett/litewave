defmodule Litewave.TestThrowingEndpoint do
  @moduledoc false
  # Mimics a hostile Phoenix endpoint whose url/0 throws instead of returning
  # a value, to prove Litewave.AppURL.detect/0 cannot be crashed by it.
  def __sockets__, do: []
  def struct_url, do: URI.parse("http://localhost:4999")

  @spec url() :: no_return()
  def url, do: throw(:boom)
end
