defmodule YPhoenix.MixProject do
  use Mix.Project

  def project do
    [
      app: :y_phoenix,
      version: "0.1.0",
      elixir: "~> 1.14",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps()
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {YPhoenix.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:phoenix, "1.8.3"},
      {:phoenix_ecto, "4.7.0"},
      {:ecto_sql, "3.13.4"},
      {:postgrex, "0.21.1"},
      {:ecto_psql_extras, "0.8.8"},
      {:phoenix_html, "4.3.0"},
      {:phoenix_live_reload, "1.6.2", only: :dev},
      # TODO bump on release to {:phoenix_live_view, "~> 1.0.0"},
      {:phoenix_live_view, "1.1.20", override: true},
      {:floki, "0.38.0", only: :test},
      {:phoenix_live_dashboard, "0.8.7"},
      {:tailwind, "0.4.1", runtime: Mix.env() == :dev},
      {:heroicons,
       github: "tailwindlabs/heroicons",
       tag: "v2.2.0",
       sparse: "optimized",
       app: false,
       compile: false,
       depth: 1},
      {:swoosh, "1.20.0"},
      {:finch, "0.20.0"},
      {:telemetry_metrics, "1.1.0"},
      {:telemetry_poller, "1.3.0"},
      {:gettext, "1.0.2"},
      {:jason, "1.4.4"},
      {:dns_cluster, "0.2.0"},
      {:bandit, "1.10.1"},
      {:rustler, "0.37.1"},
      {:y_ex, "0.10.2"},
      {:syn, "3.3.0"}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get", "ecto.setup", "assets.setup", "assets.build"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],
      "assets.setup": [
        "tailwind.install --if-missing",
        "cmd --cd assets npm install",
        "cmd --cd assets npm run install:all"
      ],
      "assets.build": ["tailwind y_phoenix", "cmd --cd assets node build.js"],
      "assets.deploy": [
        "tailwind y_phoenix --minify",
        "cmd --cd assets npm install",
        "cmd --cd assets npm run install:all",
        "cmd --cd assets node build.js --deploy",
        "phx.digest"
      ]
    ]
  end
end
