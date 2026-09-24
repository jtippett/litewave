ExUnit.start(exclude: if(System.get_env("LITEWAVE_TEST_DATABASE_URL"), do: [], else: [:postgres]))
