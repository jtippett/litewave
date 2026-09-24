import Config

if config_env() == :test do
  config :logger, level: :warning
  # Tests start their own listeners under temporary homes.
  config :litewave_phoenix, enabled: false
end
