defmodule Litewave.Tools do
  @moduledoc false
  alias Ecto.Adapters.SQL, as: EctoSQL
  alias Litewave.Output
  @compile {:no_warn_undefined, Ecto.Adapters.SQL}

  def dispatch("get_docs", args, config), do: Litewave.Source.docs(args["reference"], config)

  def dispatch("get_source_location", args, config),
    do: Litewave.Source.location(args["reference"], config)

  def dispatch("get_logs", args, _config), do: Litewave.Logs.get(args)

  def dispatch("project_eval", args, config) do
    if config.allow_eval do
      {value, _binding} =
        Code.eval_string(
          args["code"],
          [arguments: Map.get(args, "arguments", [])],
          environment(config.project)
        )

      {:ok, Output.inspect_value(value, div(config.max_output_bytes, 2))}
    else
      {:error, "capability_disabled", "Runtime evaluation is not enabled for this project."}
    end
  end

  def dispatch("execute_sql_query", args, config) do
    with true <- config.allow_sql,
         true <- Code.ensure_loaded?(EctoSQL),
         {:ok, repo} <- repository(args["repo"], config.repos),
         {:ok, result} <-
           EctoSQL.query(repo, args["query"], Map.get(args, "arguments", []),
             timeout: min(Map.get(args, "timeout", config.timeout), config.timeout),
             log: false
           ) do
      rows = Map.get(result, :rows) || []

      summary = %{
        columns: Map.get(result, :columns),
        rows: Enum.take(rows, config.max_rows),
        num_rows: Map.get(result, :num_rows),
        rows_truncated: length(rows) > config.max_rows,
        repo: inspect(repo)
      }

      {:ok, Output.inspect_value(summary, div(config.max_output_bytes, 2))}
    else
      false ->
        {:error, "capability_disabled", "SQL requires explicit enablement and Ecto SQL."}

      {:error, code, message} ->
        {:error, code, message}

      {:error, reason} ->
        detail = Output.inspect_value(reason, 4096)
        # A database error does not prove that earlier statements had no effects.
        Litewave.Runtime.error("sql_error", detail.text, "unknown")
    end
  end

  defp repository(nil, [repo]), do: {:ok, repo}
  defp repository(nil, []), do: {:error, "repo_not_found", "No Ecto repository is configured."}

  defp repository(nil, _),
    do: {:error, "repo_required", "Choose an explicit repository from phoenix_health."}

  defp repository(name, repos) do
    case Enum.find(repos, &(inspect(&1) == name)) do
      nil -> {:error, "repo_not_found", "Repository is not in the configured allowlist."}
      repo -> {:ok, repo}
    end
  end

  defp environment(project) do
    import IEx.Helpers, warn: false
    %{__ENV__ | file: Path.join(project, "litewave_eval.exs")}
  end
end
