defmodule Litewave.AppURL do
  @moduledoc false

  # A Phoenix endpoint exports __sockets__/0, url/0 and struct_url/0 and runs
  # under its own module name. Phoenix is not a dependency; detect by shape.
  # Only registered processes whose module is already loaded are considered:
  # a running endpoint has necessarily loaded its module, and loading code here
  # would pull in the host's whole code path and run its @on_load hooks.
  def detect do
    Enum.find_value(Process.registered(), &endpoint_url/1)
  end

  defp endpoint_url(name) do
    if is_atom(name) and :erlang.module_loaded(name) and
         function_exported?(name, :__sockets__, 0) and function_exported?(name, :url, 0) and
         function_exported?(name, :struct_url, 0) do
      try do
        case name.url() do
          url when is_binary(url) -> url
          _ -> nil
        end
      rescue
        _ -> nil
      catch
        _kind, _reason -> nil
      end
    end
  end
end
