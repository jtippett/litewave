defmodule Litewave.TestDocumented do
  @moduledoc "A documented test module with default arguments."

  @doc "Return a greeting."
  def greet(name \\ "reader"), do: "Hello #{name}"

  @doc "A documented callback."
  @callback handle(term()) :: term()
end
