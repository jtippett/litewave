defmodule Litewave.Config do
  @moduledoc false
  import Bitwise

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

  # Plug arguments override application environment.
  def new(opts) when is_list(opts) do
    from_env =
      :litewave_phoenix |> Application.get_all_env() |> Keyword.take(@env_options_without_project)

    case Keyword.pop(Keyword.merge(from_env, opts), :registration) do
      {nil, opts} -> explicit(opts)
      {project, opts} -> from_registration(project, opts)
    end
  end

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
