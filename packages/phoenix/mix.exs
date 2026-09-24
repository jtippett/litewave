defmodule Litewave.MixProject do
  use Mix.Project

  def project do
    [
      app: :litewave_phoenix,
      version: "0.1.0-alpha.1",
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      deps: deps(),
      aliases: [precommit: ["compile --warnings-as-errors", "format --check-formatted", "test"]],
      description: "Local Phoenix runtime access for Litewave",
      package: [
        licenses: ["MIT", "Apache-2.0"],
        files: ~w(lib mix.exs README.md LICENSE LICENSE-APACHE NOTICE)
      ]
    ]
  end

  def cli, do: [preferred_envs: [precommit: :test]]

  def application do
    [extra_applications: [:logger, :crypto, :iex], mod: {Litewave.Application, []}]
  end

  defp deps do
    [
      {:plug, "~> 1.18"},
      {:jason, "~> 1.4"},
      {:ecto_sql, "~> 3.13", optional: true},
      {:postgrex, "~> 0.21", only: :test},
      {:bandit, "~> 1.10"},
      {:req, "~> 0.7", only: :test}
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]
end
