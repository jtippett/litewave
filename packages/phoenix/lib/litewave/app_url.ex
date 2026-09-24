defmodule Litewave.AppURL do
  @moduledoc false

  # A Phoenix endpoint exports __sockets__/0, url/0 and struct_url/0 and runs
  # under its own module name. Phoenix is not a dependency; detect by shape.
  def detect do
    Application.loaded_applications()
    |> Enum.flat_map(fn {app, _, _} -> Application.spec(app, :modules) || [] end)
    |> Enum.find_value(&endpoint_url/1)
  end

  defp endpoint_url(module) do
    if Code.ensure_loaded?(module) and function_exported?(module, :__sockets__, 0) and
         function_exported?(module, :url, 0) and function_exported?(module, :struct_url, 0) and
         is_pid(Process.whereis(module)) do
      try do
        case module.url() do
          url when is_binary(url) -> url
          _ -> nil
        end
      rescue
        _ -> nil
      catch
        :exit, _ -> nil
      end
    end
  end
end
