defmodule Litewave.Paths do
  @moduledoc """
  Where Litewave keeps its files, derived identically by the Node bridge.

  * home: `LITEWAVE_HOME` or `~/.litewave`, expanded like `Path.expand/1`
  * project key: first 24 hex characters of SHA-256 of the canonical project path
  * socket: `<home>/run/p<first 16 of key>.sock`
  * descriptor: `<home>/projects/<key>/runtime.json`

  `LITEWAVE_HOME` must be the same absolute path for the application and
  every CLI/MCP client of a project.

  macOS limits socket paths to about 100 bytes; `check_length/1` enforces it.
  """
  import Bitwise

  @too_long "LITEWAVE_HOME is too long for a Unix socket. Choose a shorter path."

  @doc "The Litewave home directory: `override`, else `LITEWAVE_HOME`, else `~/.litewave`."
  @spec home(Path.t() | nil) :: Path.t()
  # Normalised the same way as the Node side's path.resolve, so both derive
  # byte-identical socket and descriptor paths.
  def home(override \\ nil) do
    Path.expand(
      override || System.get_env("LITEWAVE_HOME") || Path.join(System.user_home!(), ".litewave")
    )
  end

  @doc "The project key for a canonical project path."
  @spec key(String.t()) :: String.t()
  def key(project) when is_binary(project) do
    :crypto.hash(:sha256, project) |> Base.encode16(case: :lower) |> binary_part(0, 24)
  end

  @doc "Home, key, socket and descriptor paths for a canonical project path."
  @spec for_project(String.t(), Path.t() | nil) :: %{
          home: Path.t(),
          key: String.t(),
          socket: Path.t(),
          descriptor: Path.t()
        }
  def for_project(project, home_override \\ nil) do
    home = home(home_override)
    key = key(project)

    %{
      home: home,
      key: key,
      socket: Path.join([home, "run", "p" <> binary_part(key, 0, 16) <> ".sock"]),
      descriptor: Path.join([home, "projects", key, "runtime.json"])
    }
  end

  @doc "Refuses socket paths longer than 100 bytes with a message naming `LITEWAVE_HOME`."
  @spec check_length(Path.t()) :: :ok | {:error, String.t()}
  def check_length(socket) when byte_size(socket) > 100, do: {:error, @too_long}
  def check_length(_socket), do: :ok

  @doc """
  Creates `dir` if needed and makes it owner-only (`0700`). Returns
  `{:error, :not_owned}` for another user's directory and
  `{:error, :not_a_directory}` for a symlink or file.
  """
  @spec private_dir(Path.t()) :: :ok | {:error, :not_owned | :not_a_directory | File.posix()}
  def private_dir(dir) do
    with :ok <- File.mkdir_p(dir),
         {:ok, %{type: :directory, uid: uid, mode: mode}} <- File.lstat(dir),
         true <- uid == Litewave.Config.current_uid() || {:error, :not_owned},
         :ok <- if((mode &&& 0o777) == 0o700, do: :ok, else: File.chmod(dir, 0o700)) do
      :ok
    else
      {:ok, _other} -> {:error, :not_a_directory}
      {:error, reason} -> {:error, reason}
    end
  end
end
