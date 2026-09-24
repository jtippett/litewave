defmodule Litewave.Paths do
  @moduledoc false
  import Bitwise

  @too_long "LITEWAVE_HOME is too long for a Unix socket. Choose a shorter path."

  def home(override \\ nil) do
    override || System.get_env("LITEWAVE_HOME") || Path.join(System.user_home!(), ".litewave")
  end

  def key(project) when is_binary(project) do
    :crypto.hash(:sha256, project) |> Base.encode16(case: :lower) |> binary_part(0, 24)
  end

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

  def check_length(socket) when byte_size(socket) > 100, do: {:error, @too_long}
  def check_length(_socket), do: :ok

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
