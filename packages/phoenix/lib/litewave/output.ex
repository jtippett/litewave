defmodule Litewave.Output do
  @moduledoc false

  def limit(text, limit) when is_binary(text) do
    if byte_size(text) <= limit do
      %{text: text, truncated: false}
    else
      %{text: valid_prefix(binary_part(text, 0, limit)), truncated: true}
    end
  end

  def inspect_value(value, limit) do
    value
    |> inspect(pretty: true, limit: 100, printable_limit: limit, charlists: :as_lists)
    |> limit(limit)
  end

  defp valid_prefix(text) do
    if String.valid?(text),
      do: text,
      else: valid_prefix(binary_part(text, 0, byte_size(text) - 1))
  end
end
