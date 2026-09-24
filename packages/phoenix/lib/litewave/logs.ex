defmodule Litewave.Logs do
  @moduledoc false
  use GenServer
  @capacity 1024
  @levels ~w(emergency alert critical error warning notice info debug)

  def start_link(_), do: GenServer.start_link(__MODULE__, nil, name: __MODULE__)

  @impl true
  def init(_) do
    :ets.new(__MODULE__, [:named_table, :public, :ordered_set, write_concurrency: true])
    :ets.insert(__MODULE__, {:sequence, 0})
    :logger.remove_handler(__MODULE__)
    :ok = :logger.add_handler(__MODULE__, __MODULE__, %{level: :all})
    {:ok, nil}
  end

  def log(%{meta: meta} = event, _config) do
    unless meta[:litewave_runtime] do
      text =
        event
        |> :logger_formatter.format(%{single_line: false, chars_limit: 4096})
        |> IO.iodata_to_binary()

      record(Atom.to_string(event.level), text)
    end
  end

  def record(level, text) do
    id = :ets.update_counter(__MODULE__, :sequence, 1)

    entry = %{
      cursor: id,
      level: level,
      text: Litewave.Output.limit(text, 4096).text,
      timestamp: DateTime.utc_now() |> DateTime.to_iso8601()
    }

    :ets.insert(__MODULE__, {id, entry})
    current = :ets.lookup_element(__MODULE__, :sequence, 2)

    :ets.select_delete(__MODULE__, [
      {{:"$1", :_}, [{:is_integer, :"$1"}, {:"=<", :"$1", current - @capacity}], [true]}
    ])

    :ok
  end

  def get(args) do
    cursor = Map.get(args, "cursor", 0)
    tail = Map.get(args, "tail", 50)
    level = Map.get(args, "level")
    grep = Map.get(args, "grep", "")

    if is_integer(cursor) and cursor >= 0 and is_integer(tail) and tail in 1..200 and
         (is_nil(level) or level in @levels) and is_binary(grep) and byte_size(grep) <= 200 do
      latest = :ets.lookup_element(__MODULE__, :sequence, 2)
      earliest = max(1, latest - @capacity + 1)
      reset? = cursor > latest
      after_cursor = if reset?, do: 0, else: cursor

      entries =
        :ets.tab2list(__MODULE__)
        |> Enum.filter(fn {id, _} -> is_integer(id) and id > after_cursor and id <= latest end)
        |> Enum.sort_by(&elem(&1, 0))
        |> Enum.map(&elem(&1, 1))
        |> Enum.filter(fn entry ->
          (is_nil(level) or level == entry.level) and
            String.contains?(String.downcase(entry.text), String.downcase(grep))
        end)

      selected =
        if Map.has_key?(args, "cursor"),
          do: Enum.take(entries, tail),
          else: Enum.take(entries, -tail)

      more? = Map.has_key?(args, "cursor") and length(entries) > tail
      next = if more?, do: List.last(selected).cursor, else: latest

      {:ok,
       %{
         entries: selected,
         next_cursor: next,
         gap: reset? or cursor < earliest - 1,
         reset: reset?,
         oldest_cursor: earliest,
         has_more: more?
       }}
    else
      {:error, "invalid_arguments", "Invalid log cursor, tail, level, or grep."}
    end
  end
end
