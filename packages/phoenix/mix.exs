defmodule Litewave.MixProject do
  use Mix.Project

  @version "0.1.0-alpha.1"
  @source_url "https://github.com/jtippett/litewave"

  def project do
    [
      app: :litewave_phoenix,
      version: @version,
      elixir: "~> 1.17",
      elixirc_paths: elixirc_paths(Mix.env()),
      deps: deps(),
      aliases: aliases(),
      dialyzer: [
        plt_add_apps: [:mix, :iex, :ex_unit],
        plt_file: {:no_warn, "priv/plts/litewave_phoenix.plt"},
        flags: [:unmatched_returns, :error_handling, :extra_return, :missing_return]
      ],
      name: "Litewave Phoenix",
      description:
        "Development-only Phoenix runtime tools for the Litewave CLI and MCP bridge, published on a private Unix socket at boot.",
      source_url: @source_url,
      homepage_url: @source_url,
      docs: docs(),
      package: package()
    ]
  end

  defp package do
    [
      licenses: ["MIT", "Apache-2.0"],
      maintainers: ["James Tippett"],
      links: %{
        "GitHub" => @source_url,
        "Changelog" => "#{@source_url}/blob/main/packages/phoenix/CHANGELOG.md"
      },
      files: ~w(lib mix.exs .formatter.exs README.md CHANGELOG.md LICENSE LICENSE-APACHE NOTICE)
    ]
  end

  defp docs do
    [
      main: "readme",
      source_ref: "v#{@version}",
      source_url_pattern: "#{@source_url}/blob/v#{@version}/packages/phoenix/%{path}#L%{line}",
      extras: ["README.md", "CHANGELOG.md"],
      groups_for_modules: [
        Integration: [Litewave],
        Configuration: [Litewave.Config],
        Internal: [Litewave.Listener, Litewave.Paths]
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
      {:req, "~> 0.7", only: :test},
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      {:dialyxir, "~> 1.4", only: [:dev, :test], runtime: false},
      {:ex_doc, "~> 0.40", only: :dev, runtime: false}
    ]
  end

  defp aliases do
    [
      precommit: [
        "compile --warnings-as-errors",
        "format --check-formatted",
        "credo --strict",
        "dialyzer",
        "test"
      ]
    ]
  end

  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]
end
