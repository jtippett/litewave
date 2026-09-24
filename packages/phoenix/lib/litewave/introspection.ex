# Adapted from Tidewave.MCP.Tools.Source (Tidewave Phoenix 0.9.0).
# Copyright (c) 2025 Dashbit. Licensed under Apache-2.0; see LICENSE-APACHE.
# Source-location traversal derives from IEx.Introspection in Elixir.
# Changes: no transport schemas, no rescue, known-module/function parsing, structured absolute locations.
# credo:disable-for-this-file Credo.Check.Refactor.Nesting
# Kept close to the upstream Tidewave source; see NOTICE.
# credo:disable-for-this-file Credo.Check.Refactor.CyclomaticComplexity
# Kept close to the upstream Tidewave source; see NOTICE.
defmodule Litewave.Introspection do
  @moduledoc false

  def get_source_location(args) do
    case args do
      %{"reference" => "dep:" <> package} ->
        path =
          Enum.find_value(Mix.Project.deps_paths(), fn {name, path} ->
            if Atom.to_string(name) == package, do: path
          end)

        if path do
          {:ok, path}
        else
          {:error, "Package #{package} not found."}
        end

      %{"reference" => ref} ->
        case parse_reference(ref) do
          {:ok, mod, fun, arity} ->
            find_source_for_mfa(mod, fun, arity)

          :error ->
            {:error, "Failed to parse reference: #{inspect(ref)}"}
        end

      _ ->
        {:error, :invalid_arguments}
    end
  end

  def get_docs(args) do
    case args do
      %{"reference" => ref} ->
        {ref, lookup} =
          case ref do
            "c:" <> ref -> {ref, [:callback]}
            _ -> {ref, [:function, :macro]}
          end

        case parse_reference(ref) do
          {:ok, mod, fun, arity} ->
            case Code.ensure_loaded(mod) do
              {:module, _} ->
                with {:ok, _, docs} <- find_docs_for_mfa(mod, fun, arity, lookup) do
                  {:ok, docs}
                end

              {:error, reason} ->
                {:error, "Could not load module #{inspect(mod)}, got: #{reason}"}
            end

          :error ->
            {:error, "Failed to parse reference: #{inspect(ref)}"}
        end

      _ ->
        {:error, :invalid_arguments}
    end
  end

  def parse_reference(reference) when is_binary(reference) do
    pattern =
      ~r/\A(?<module>[A-Z][a-zA-Z0-9_]*(?:\.[A-Z][a-zA-Z0-9_]*)*|:[a-z][a-zA-Z0-9_]*)(?:\.(?<function>[^.\/\s()]+)(?:\/(?<arity>[0-9]{1,3}))?)?\z/

    with %{} = parts <- Regex.named_captures(pattern, reference),
         module when not is_nil(module) <- existing_module(parts["module"]),
         {:module, _} <- Code.ensure_loaded(module),
         {:ok, function} <- existing_function(module, parts["function"]),
         arity = if(parts["arity"] == "", do: :*, else: String.to_integer(parts["arity"])),
         true <- arity == :* or arity in 0..255 do
      {:ok, module, function, arity}
    else
      _ -> :error
    end
  end

  defp existing_module(name) do
    modules =
      for {app, _, _} <- Application.loaded_applications(),
          module <- Application.spec(app, :modules) || [],
          do: module

    name = String.replace_prefix(name, "Elixir.", "")
    Enum.find(modules ++ Enum.map(:code.all_loaded(), &elem(&1, 0)), &(inspect(&1) == name))
  end

  defp existing_function(_module, ""), do: {:ok, nil}

  defp existing_function(module, name) do
    docs =
      case Code.fetch_docs(module) do
        {:docs_v1, _, _, _, _, _, entries} ->
          Enum.map(entries, fn {{_, fun, _}, _, _, _, _} -> fun end)

        _ ->
          []
      end

    functions = Enum.map(module.module_info(:functions), &elem(&1, 0)) ++ docs

    case Enum.find(functions, &(Atom.to_string(&1) == name)) do
      nil -> :error
      function -> {:ok, function}
    end
  end

  defp find_source_for_mfa(mod, function, arity) do
    result = open_mfa(mod, function, arity)

    case result do
      {_source_file, _module_pair, {fun_file, fun_line}} ->
        line =
          case find_docs_for_mfa(mod, function, arity, [:function, :macro]) do
            {:ok, line, _} when line < fun_line -> line
            _ -> fun_line
          end

        {:ok, %{path: fun_file, line: line}}

      {_source_file, {module_file, module_line}, nil} ->
        {:ok, %{path: module_file, line: module_line}}

      {source_file, nil, nil} ->
        {:ok, %{path: source_file, line: nil}}

      {:error, error} ->
        {:error, "Failed to get source location: #{inspect(error)}"}
    end
  end

  # open helpers, extracted from IEx.Introspection
  defp open_mfa(module, fun, arity) do
    case Code.ensure_loaded(module) do
      {:module, _} ->
        case module.module_info(:compile)[:source] do
          [_ | _] = source ->
            with {:ok, source} <- rewrite_source(module, source) do
              open_abstract_code(module, fun, arity, source)
            end

          _ ->
            {:error, "source code is not available"}
        end

      _ ->
        {:error, "module is not available"}
    end
  end

  defp open_abstract_code(module, fun, arity, source) do
    fun = Atom.to_string(fun)

    with [_ | _] = beam <- :code.which(module),
         {:ok, {_, [abstract_code: abstract_code]}} <- :beam_lib.chunks(beam, [:abstract_code]),
         {:raw_abstract_v1, code} <- abstract_code do
      {_, module_pair, fa_pair} =
        Enum.reduce(code, {source, nil, nil}, &open_abstract_code_reduce(&1, &2, fun, arity))

      {source, module_pair, fa_pair}
    else
      _ ->
        {source, nil, nil}
    end
  end

  defp open_abstract_code_reduce(entry, {file, module_pair, fa_pair}, fun, arity) do
    case entry do
      {:attribute, ann, :module, _} ->
        {file, {file, :erl_anno.line(ann)}, fa_pair}

      {:function, ann, ann_fun, ann_arity, _} ->
        case Atom.to_string(ann_fun) do
          "MACRO-" <> ^fun when arity == :* or ann_arity == arity + 1 ->
            {file, module_pair, fa_pair || {file, :erl_anno.line(ann)}}

          ^fun when arity == :* or ann_arity == arity ->
            {file, module_pair, fa_pair || {file, :erl_anno.line(ann)}}

          _ ->
            {file, module_pair, fa_pair}
        end

      _ ->
        {file, module_pair, fa_pair}
    end
  end

  @elixir_apps ~w(eex elixir ex_unit iex logger mix)a
  @otp_apps ~w(kernel stdlib)a
  @apps @elixir_apps ++ @otp_apps

  defp rewrite_source(module, source) do
    case :application.get_application(module) do
      {:ok, app} when app in @apps ->
        {:error,
         "Cannot get source of core libraries, use the eval_project tool with the `h(...)` helper to read documentation instead."}

      _ ->
        beam_path = :code.which(module)

        if is_list(beam_path) and List.starts_with?(beam_path, :code.root_dir()) do
          app_vsn = beam_path |> Path.dirname() |> Path.dirname() |> Path.basename()
          {:ok, Path.join([:code.root_dir(), "lib", app_vsn, rewrite_source(source)])}
        else
          {:ok, List.to_string(source)}
        end
    end
  end

  defp rewrite_source(source) do
    {in_app, [lib_or_src | _]} =
      source
      |> Path.split()
      |> Enum.reverse()
      |> Enum.split_while(&(&1 not in ["lib", "src"]))

    Path.join([lib_or_src | Enum.reverse(in_app)])
  end

  defp find_docs_for_mfa(mod, nil, :*, _lookup) do
    case Code.fetch_docs(mod) do
      {:docs_v1, ann, _, "text/markdown", %{"en" => content}, _, _} ->
        {:ok, :erl_anno.line(ann), "# #{inspect(mod)}\n\n#{content}"}

      {:docs_v1, _, _, _, _, _, _} ->
        {:error, "Documentation not found for #{inspect(mod)}"}

      _ ->
        {:error, "No documentation available for #{inspect(mod)}"}
    end
  end

  defp find_docs_for_mfa(mod, fun, arity, lookup) do
    mod
    |> get_function_docs(lookup)
    |> filter_function_docs(fun, arity)
    |> case do
      [] ->
        {:error, "Documentation not found for #{inspect(mod)}.#{fun}/#{arity}"}

      docs ->
        [{line, _} | _] =
          formatted_docs =
          docs
          |> Enum.map(fn {{type, fun, arity}, ann, signature, doc, metadata} ->
            {:erl_anno.line(ann),
             format_function_docs(type, mod, fun, arity, signature, doc, metadata)}
          end)
          |> Enum.sort()

        {:ok, line, Enum.map_join(formatted_docs, "\n\n", &elem(&1, 1))}
    end
  end

  defp get_function_docs(mod, kinds) do
    case Code.fetch_docs(mod) do
      {:docs_v1, _, _, "text/markdown", _, _, docs} ->
        for {{kind, _, _}, _, _, _, _} = doc <- docs, kind in kinds, do: doc

      {:error, _} ->
        []
    end
  end

  defp filter_function_docs(docs, fun, arity) when is_integer(arity) do
    doc =
      Enum.find(docs, &match?({{_, ^fun, ^arity}, _, _, _, _}, &1)) ||
        find_doc_defaults(docs, fun, arity)

    case doc do
      {_, _, _, %{"en" => _}, _} -> [doc]
      _ -> []
    end
  end

  defp filter_function_docs(docs, fun, :*) do
    Enum.filter(docs, fn
      {{_, ^fun, _}, _, _, %{"en" => _}, _} -> true
      _ -> false
    end)
  end

  defp find_doc_defaults(docs, function, min) do
    Enum.find(docs, fn
      {{_, ^function, arity}, _, _, _, %{defaults: defaults}} when arity > min ->
        arity <= min + defaults

      _ ->
        false
    end)
  end

  defp format_function_docs(type, mod, fun, arity, signature, %{"en" => content}, _metadata) do
    prefix = if type == :callback, do: "c:", else: ""

    """
    # #{prefix}#{inspect(mod)}.#{fun}/#{arity}

    ```elixir
    #{Enum.join(signature, "\n")}
    ```

    #{content}\
    """
  end
end
