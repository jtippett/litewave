defmodule Litewave.PathsTest do
  use ExUnit.Case, async: true
  alias Litewave.Paths

  test "key is the first 24 hex characters of sha256 of the canonical project" do
    expected =
      :crypto.hash(:sha256, "/tmp/project") |> Base.encode16(case: :lower) |> binary_part(0, 24)

    assert Paths.key("/tmp/project") == expected
    assert byte_size(Paths.key("/tmp/project")) == 24
  end

  test "socket and descriptor derive from home and project only" do
    paths = Paths.for_project("/tmp/project", "/tmp/lw-home")
    key = Paths.key("/tmp/project")
    assert paths.home == "/tmp/lw-home"
    assert paths.key == key
    assert paths.socket == "/tmp/lw-home/run/p" <> binary_part(key, 0, 16) <> ".sock"
    assert paths.descriptor == "/tmp/lw-home/projects/" <> key <> "/runtime.json"
  end

  test "home honours the explicit override, then LITEWAVE_HOME, then ~/.litewave" do
    assert Paths.home("/explicit") == "/explicit"
    System.put_env("LITEWAVE_HOME", "/from-env")
    on_exit(fn -> System.delete_env("LITEWAVE_HOME") end)
    assert Paths.home(nil) == "/from-env"
    System.delete_env("LITEWAVE_HOME")
    assert Paths.home(nil) == Path.join(System.user_home!(), ".litewave")
  end

  test "home is normalised like the Node side's path.resolve" do
    System.put_env("LITEWAVE_HOME", "/tmp/./lw-x//")
    on_exit(fn -> System.delete_env("LITEWAVE_HOME") end)
    assert Paths.home(nil) == "/tmp/lw-x"
    assert Paths.home("relative/dir") == Path.expand("relative/dir")
  end

  test "socket paths longer than 100 bytes are refused with the documented message" do
    long = String.duplicate("a", 101)

    assert Paths.check_length(long) ==
             {:error, "LITEWAVE_HOME is too long for a Unix socket. Choose a shorter path."}

    assert Paths.check_length(String.duplicate("a", 100)) == :ok
  end

  test "private_dir creates an owner-only directory and tightens loose permissions" do
    dir = Path.join(System.tmp_dir!(), "lw-paths-#{System.unique_integer([:positive])}")
    on_exit(fn -> File.rm_rf!(dir) end)
    assert :ok = Paths.private_dir(dir)
    assert Bitwise.band(File.stat!(dir).mode, 0o777) == 0o700
    File.chmod!(dir, 0o755)
    assert :ok = Paths.private_dir(dir)
    assert Bitwise.band(File.stat!(dir).mode, 0o777) == 0o700
  end
end
