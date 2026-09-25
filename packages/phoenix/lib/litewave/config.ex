defmodule Litewave.Config do
  @moduledoc """
  Runtime configuration for both transports.

  Options may be given as arguments to the `Litewave` Plug or under
  `config :litewave_phoenix` in `config/dev.exs`. The socket transport
  started at boot reads only the application environment.

  | Option             | Default                                  | Meaning                                                                                  |
  | ------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------- |
  | `:enabled`         | `true`                                   | Publish the boot-time socket. Application environment only.                              |
  | `:allow_eval`      | `false`                                  | Allow `project_eval`. Executes arbitrary Elixir in the app; not a sandbox.               |
  | `:allow_sql`       | `false`                                  | Allow `execute_sql_query`. SQL is **read-write**.                                        |
  | `:repos`           | `:ecto_repos` of loaded applications     | Repositories SQL may target.                                                             |
  | `:roots`           | Mix dependency paths plus the project    | Directories `get_source_location` may reveal.                                            |
  | `:timeout`         | `10_000`                                 | Execution timeout in ms, at most `30_000`.                                               |
  | `:max_output_bytes`| `64_000`                                 | Bound on captured output, `1_024..256_000`.                                              |
  | `:max_rows`        | `50`                                     | SQL rows returned, at most `500`.                                                        |
  | `:project`         | the Mix project directory                | Canonical project path. Socket transport: application environment or default.           |
  | `:environment`     | the host `Mix.env()`                     | Must be `:dev` or `:test`. Plug argument, or application environment for the socket transport; defaults to the host `Mix.env()`. |
  | `:project_id`      | `Litewave.Paths.key(project)`            | Plug argument only; the default is what the CLI expects.                                 |
  | `:endpoint`        | required for the Plug                    | Loopback origin the Plug is served on, e.g. `"http://localhost:4000"`.                   |
  | `:token_file`      | required for the Plug                    | Private file created by `litewave phoenix setup`.                                        |
  | `:registration`    | —                                        | Plug only: resolve `project`, `endpoint`, `token_file` from the CLI's files for this path.|

  Every option is validated at boot or when the `Litewave` Plug initializes;
  an invalid value raises `ArgumentError` so a misconfiguration is visible
  immediately.
  """
  import Bitwise

  @typedoc "Validated configuration shared by the socket listener and the Plug."
  @type t :: %{
          project: String.t(),
          project_id: String.t(),
          owner_uid: non_neg_integer(),
          environment: :dev | :test,
          roots: [String.t()],
          repos: [module()],
          allow_eval: boolean(),
          allow_sql: boolean(),
          max_output_bytes: pos_integer(),
          max_rows: pos_integer(),
          timeout: pos_integer(),
          transport: :socket | :endpoint,
          endpoint: URI.t() | nil,
          token_file: String.t() | nil
        }

  @doc """
  The Mix environment of the *host* application, or `:prod` when no Mix
  project is running (releases). Dependencies compile under `:prod` even in a
  development host, so `Mix.env/0` of this package is never consulted.
  """
  @spec environment() :: atom()
  # Dependencies normally compile under :prod, even in a development host.
  # Require a running Mix project; releases must never enable runtime access.
  def environment do
    if Code.ensure_loaded?(Mix) and is_pid(Process.whereis(Mix.ProjectStack)) and
         not is_nil(Mix.Project.get()),
       do: Mix.env(),
       else: :prod
  end

  @env_options ~w(allow_eval allow_sql repos roots timeout max_output_bytes max_rows project environment)a
  # The Plug takes its project from its own arguments or the registration, and
  # its environment from its own arguments or the host, never from application
  # environment.
  @env_options_without_project @env_options -- [:project, :environment]

  @doc """
  Builds the Plug configuration (transport `:endpoint`) from Plug arguments
  merged over `:litewave_phoenix` application environment. See the module
  documentation for the options. Raises `ArgumentError` on invalid or
  production configuration.
  """
  @spec new(keyword()) :: t()
  # Plug arguments override application environment.
  def new(opts) when is_list(opts) do
    from_env =
      :litewave_phoenix |> Application.get_all_env() |> Keyword.take(@env_options_without_project)

    case Keyword.pop(Keyword.merge(from_env, opts), :registration) do
      {nil, opts} -> explicit(opts)
      {project, opts} -> from_registration(project, opts)
    end
  end

  @doc """
  Builds the boot-time socket configuration (transport `:socket`) from
  application environment merged under `opts`. The project defaults to the
  directory of the running Mix project, canonicalised. Raises
  `ArgumentError` on invalid or production configuration.
  """
  @spec socket(keyword()) :: t()
  def socket(opts \\ []) when is_list(opts) do
    from_env = :litewave_phoenix |> Application.get_all_env() |> Keyword.take(@env_options)
    opts = Keyword.merge(from_env, opts)

    project =
      case Keyword.fetch(opts, :project) do
        {:ok, project} -> project
        :error -> Path.dirname(Mix.Project.project_file())
      end

    project =
      case Litewave.Source.canonical(project) do
        {:ok, canonical} -> canonical
        _ -> Path.expand(project)
      end

    opts
    |> Keyword.put(:project, project)
    |> base()
    |> Map.merge(%{transport: :socket, endpoint: nil, token_file: nil})
  end

  defp explicit(opts) do
    endpoint = opts |> Keyword.fetch!(:endpoint) |> URI.parse()

    unless endpoint.scheme in ["http", "https"] and
             endpoint.host in ["localhost", "127.0.0.1", "::1"] and
             is_nil(endpoint.userinfo) and is_nil(endpoint.query) and is_nil(endpoint.fragment) and
             endpoint.path in [nil, "", "/"] do
      raise ArgumentError, "Litewave endpoint must be an explicit loopback HTTP(S) origin"
    end

    opts
    |> base()
    |> Map.merge(%{
      transport: :endpoint,
      endpoint: endpoint,
      token_file: opts |> Keyword.fetch!(:token_file) |> Path.expand()
    })
  end

  # Fields shared by both transports. `project_id` defaults to the project key.
  defp base(opts) do
    environment = Keyword.get(opts, :environment, environment())

    unless environment() in [:dev, :test] and environment in [:dev, :test] do
      raise ArgumentError, "Litewave runtime access is development-only"
    end

    project = opts |> Keyword.fetch!(:project) |> Path.expand()

    %{
      project: project,
      project_id: Keyword.get(opts, :project_id, Litewave.Paths.key(project)),
      owner_uid: current_uid(),
      environment: environment,
      roots: Enum.uniq([project | Keyword.get(opts, :roots, dependency_roots())]),
      repos: Keyword.get(opts, :repos, repositories()),
      allow_eval: boolean_option(opts, :allow_eval),
      allow_sql: boolean_option(opts, :allow_sql),
      max_output_bytes: bounded(opts, :max_output_bytes, 64_000, 1024, 256_000),
      max_rows: bounded(opts, :max_rows, 50, 1, 500),
      timeout: bounded(opts, :timeout, 10_000, 1, 30_000)
    }
  end

  defp from_registration(project, opts) do
    with {:ok, project} <- Litewave.Source.canonical(project),
         paths = Litewave.Paths.for_project(project),
         directory = Path.dirname(paths.descriptor),
         {:ok, data} <- File.read(Path.join(directory, "registration.json")),
         {:ok, %{"project" => ^project}} <- Jason.decode(data),
         {:ok, data} <- File.read(Path.join(directory, "phoenix.json")),
         {:ok, %{"project_id" => project_id, "endpoint" => endpoint, "token_file" => token_file}} <-
           Jason.decode(data),
         true <- project_id == paths.key do
      origin = endpoint |> URI.parse() |> Map.put(:path, nil) |> URI.to_string()

      explicit(
        Keyword.merge(opts,
          project: project,
          project_id: project_id,
          endpoint: origin,
          token_file: token_file
        )
      )
    else
      _ ->
        raise ArgumentError,
              "Litewave registration is missing or mismatched. Run litewave init and litewave phoenix setup for this project first."
    end
  end

  @doc false
  @spec token(Path.t(), non_neg_integer()) :: {:ok, String.t()} | {:error, :invalid_token_file}
  def token(file, owner_uid) do
    with {:ok, %{type: :regular, mode: mode, uid: ^owner_uid}} when (mode &&& 0o077) == 0 <-
           File.lstat(file),
         {:ok, token} <- File.read(file),
         token = String.trim(token),
         true <- byte_size(token) in 32..256 do
      {:ok, token}
    else
      _ -> {:error, :invalid_token_file}
    end
  end

  defp boolean_option(opts, key) do
    value = Keyword.get(opts, key, false)
    if is_boolean(value), do: value, else: raise(ArgumentError, "#{key} must be a boolean")
  end

  @doc false
  @spec current_uid() :: non_neg_integer()
  def current_uid do
    {uid, 0} = System.cmd("id", ["-u"])
    uid |> String.trim() |> String.to_integer()
  end

  defp bounded(opts, key, default, min, max) do
    value = Keyword.get(opts, key, default)

    if is_integer(value) and value >= min and value <= max,
      do: value,
      else: raise(ArgumentError, "invalid #{key}")
  end

  defp dependency_roots do
    if Code.ensure_loaded?(Mix.Project) and Mix.Project.get(),
      do: Map.values(Mix.Project.deps_paths()),
      else: []
  end

  defp repositories do
    Application.loaded_applications()
    |> Enum.flat_map(fn {app, _, _} -> Application.get_env(app, :ecto_repos, []) end)
    |> Enum.uniq()
  end
end
