import Config

# credo strict requires every metadata key the package logs with to be declared here; the key itself only filters runtime-originated events in Litewave.Logs.
config :logger, :default_formatter, metadata: [:litewave_runtime]

if config_env() == :test do
  config :logger, level: :warning
  # Tests start their own listeners under temporary homes.
  config :litewave_phoenix, enabled: false
end
