defmodule Litewave.Capture do
  @moduledoc false
  use GenServer

  def start(limit), do: GenServer.start(__MODULE__, {limit, self()})
  def contents(pid), do: GenServer.call(pid, :contents)

  @impl true
  def init({limit, owner}) do
    Process.monitor(owner)
    {:ok, %{limit: limit, text: "", truncated: false}}
  end

  @impl true
  def handle_call(:contents, _from, state),
    do: {:reply, Map.take(state, [:text, :truncated]), state}

  @impl true
  def handle_info({:DOWN, _, :process, _, _}, state), do: {:stop, :normal, state}

  def handle_info({:io_request, from, reply_as, request}, state) do
    {reply, state} = request(request, state)
    send(from, {:io_reply, reply_as, reply})
    {:noreply, state}
  end

  defp request({:put_chars, encoding, chars}, state) when encoding in [:unicode, :latin1] do
    case :unicode.characters_to_binary(chars, encoding) do
      text when is_binary(text) -> {:ok, append(state, text)}
      _ -> {{:error, :put_chars}, state}
    end
  end

  defp request({:put_chars, chars}, state), do: request({:put_chars, :unicode, chars}, state)

  defp request({:put_chars, encoding, module, function, args}, state) do
    request({:put_chars, encoding, apply(module, function, args)}, state)
  end

  defp request({:put_chars, module, function, args}, state),
    do: request({:put_chars, :unicode, module, function, args}, state)

  defp request({:requests, requests}, state) do
    Enum.reduce_while(requests, {:ok, state}, fn req, {_, state} ->
      case request(req, state) do
        {:ok, next} -> {:cont, {:ok, next}}
        error -> {:halt, error}
      end
    end)
  end

  defp request(:getopts, state), do: {{:ok, [encoding: :unicode]}, state}
  defp request({:setopts, _}, state), do: {:ok, state}
  defp request(_, state), do: {{:error, :enotsup}, state}

  defp append(state, text) do
    remaining = state.limit - byte_size(state.text)
    bounded = Litewave.Output.limit(text, remaining)
    %{state | text: state.text <> bounded.text, truncated: state.truncated or bounded.truncated}
  end
end
