defmodule Litewave.Source do
  @moduledoc false
  alias Litewave.Introspection

  def docs(reference, config) do
    parsed_reference = String.replace_prefix(reference, "c:", "")

    with {:ok, module, _, _} <- Introspection.parse_reference(parsed_reference),
         :ok <- allowed_module(module, config),
         {:ok, text} <- Introspection.get_docs(%{"reference" => reference}) do
      {:ok, Litewave.Output.limit(text, div(config.max_output_bytes, 2))}
    else
      {:error, code, message} ->
        {:error, code, message}

      _ ->
        {:error, "docs_not_found",
         "Documentation was not found for that module/function reference."}
    end
  end

  def location("dep:" <> dependency, config) do
    with {:ok, file} when is_binary(file) <-
           Introspection.get_source_location(%{"reference" => "dep:" <> dependency}),
         :ok <- allowed_path(file, config.roots) do
      {:ok, %{path: file, line: nil}}
    else
      _ ->
        {:error, "source_not_found", "Dependency source is unavailable or outside allowed roots."}
    end
  end

  def location(reference, config) do
    with {:ok, %{path: file} = location} <-
           Introspection.get_source_location(%{"reference" => reference}),
         :ok <- allowed_path(file, config.roots) do
      {:ok, location}
    else
      _ -> {:error, "source_not_found", "Source is unavailable or outside allowed roots."}
    end
  end

  @core_apps [:elixir, :iex, :logger, :eex, :ex_unit, :mix, :kernel, :stdlib]

  defp allowed_module(module, config) do
    with {:module, _} <- Code.ensure_loaded(module),
         source when is_list(source) <- module.module_info(:compile)[:source] do
      case allowed_path(List.to_string(source), config.roots) do
        :ok -> :ok
        _ -> core_library_result(module)
      end
    else
      _ -> {:error, "docs_not_found", "Module is unavailable."}
    end
  end

  # Standard-library docs come from installed BEAM chunks, without exposing core source files.
  defp core_library_result(module) do
    case :application.get_application(module) do
      {:ok, app} when app in @core_apps ->
        :ok

      _ ->
        {:error, "path_not_allowed",
         "Module is outside the project and declared dependency roots."}
    end
  end

  def allowed_path(file, roots) do
    with {:ok, canonical} <- canonical(file, 40) do
      if Enum.any?(roots, &root_match?(&1, canonical)),
        do: :ok,
        else: {:error, :outside_roots}
    end
  end

  defp root_match?(root, canonical) do
    case canonical(root, 40) do
      {:ok, root} -> canonical == root or String.starts_with?(canonical, root <> "/")
      _ -> false
    end
  end

  def canonical(file), do: canonical(file, 40)

  defp canonical(_, 0), do: {:error, :symlink_loop}

  defp canonical(file, remaining) do
    [root | parts] = file |> Path.expand() |> Path.split()
    Enum.reduce_while(parts, {:ok, root}, &canonical_step(&1, &2, remaining))
  end

  defp canonical_step(part, {:ok, acc}, remaining) do
    path = Path.join(acc, part)

    case File.lstat(path) do
      {:ok, %{type: :symlink}} -> resolve_symlink(path, remaining)
      {:ok, _} -> {:cont, {:ok, path}}
      error -> {:halt, error}
    end
  end

  defp resolve_symlink(path, remaining) do
    with {:ok, target} <- File.read_link(path),
         {:ok, resolved} <- canonical(Path.expand(target, Path.dirname(path)), remaining - 1) do
      {:cont, {:ok, resolved}}
    else
      error -> {:halt, error}
    end
  end
end
