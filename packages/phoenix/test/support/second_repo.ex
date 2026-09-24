defmodule Litewave.SecondRepo do
  @moduledoc false
  use Ecto.Repo, otp_app: :litewave_phoenix, adapter: Ecto.Adapters.Postgres
end
