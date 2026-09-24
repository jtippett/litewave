defmodule Litewave.SQLTest do
  use ExUnit.Case, async: false
  @moduletag :postgres

  setup do
    url = System.fetch_env!("LITEWAVE_TEST_DATABASE_URL")
    start_supervised!({Litewave.FirstRepo, url: url, pool_size: 1})
    start_supervised!({Litewave.SecondRepo, url: url, pool_size: 1})

    config =
      Litewave.init(
        project: File.cwd!(),
        project_id: "sql-tests",
        endpoint: "http://localhost:4700",
        token_file: "/unused-direct-call",
        allow_sql: true,
        repos: [Litewave.FirstRepo, Litewave.SecondRepo],
        max_rows: 2
      )

    %{config: config}
  end

  test "parameterized PostgreSQL queries return bounded rows from the selected repo", ctx do
    result = query(ctx, "SELECT n FROM generate_series(1, $1::integer) AS n", [5])
    assert result.status == "ok"
    assert result.result.text =~ "rows_truncated: true"
    assert result.result.text =~ "num_rows: 5"
    assert result.result.text =~ "[[1], [2]]"
    second = query(ctx, "SELECT 23", [], "Litewave.SecondRepo")
    assert second.result.text =~ "Litewave.SecondRepo"
    assert second.result.text =~ "[[23]]"
  end

  test "parity SQL writes only the isolated test connection's temporary table", ctx do
    assert query(ctx, "CREATE TEMP TABLE litewave_fixture (value integer)").status == "ok"
    id = unique()

    args = %{
      "method" => "execute_sql_query",
      "request_id" => id,
      "runtime_id" => Litewave.Runtime.identity(),
      "query" => "INSERT INTO litewave_fixture VALUES ($1)",
      "arguments" => [7],
      "repo" => "Litewave.FirstRepo"
    }

    assert Litewave.Runtime.execute(args, ctx.config).status == "ok"
    assert Litewave.Runtime.execute(args, ctx.config).status == "ok"
    assert query(ctx, "SELECT COUNT(*) FROM litewave_fixture").result.text =~ "[[1]]"
  end

  test "database errors and timeouts preserve runtime health and report uncertain effects", ctx do
    failed = query(ctx, "SELECT * FROM litewave_nonexistent_table")
    assert failed.status == "outcome_unknown"
    assert failed.error.code == "sql_error"

    timeout =
      Litewave.Runtime.execute(
        %{
          "method" => "execute_sql_query",
          "request_id" => unique(),
          "runtime_id" => Litewave.Runtime.identity(),
          "query" => "SELECT pg_sleep(1)",
          "timeout" => 20,
          "repo" => "Litewave.FirstRepo"
        },
        ctx.config
      )

    assert timeout.status == "outcome_unknown"
    assert query(ctx, "SELECT 1").status == "ok"
  end

  defp query(ctx, query, arguments \\ [], repo \\ "Litewave.FirstRepo") do
    Litewave.Runtime.execute(
      %{
        "method" => "execute_sql_query",
        "request_id" => unique(),
        "runtime_id" => Litewave.Runtime.identity(),
        "query" => query,
        "arguments" => arguments,
        "repo" => repo
      },
      ctx.config
    )
  end

  defp unique, do: "sql-#{System.unique_integer([:positive])}"
end
