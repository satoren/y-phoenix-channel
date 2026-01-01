defmodule YPhoenix.Application do
  # See https://hexdocs.pm/elixir/Application.html
  # for more information on OTP Applications
  @moduledoc false

  use Application

  @impl true
  def start(_type, _args) do
    # Initialize Syn scopes for distributed DocServer registry
    :syn.add_node_to_scopes([:doc_servers])

    children = [
      YPhoenixWeb.Telemetry,
      YPhoenix.Repo,
      {DNSCluster, query: Application.get_env(:y_phoenix, :dns_cluster_query) || :ignore},
      {Phoenix.PubSub, name: YPhoenix.PubSub},
      YPhoenixWeb.Presence,
      # Start the Finch HTTP client for sending emails
      {Finch, name: YPhoenix.Finch},
      # Start a worker by calling: YPhoenix.Worker.start_link(arg)
      # {YPhoenix.Worker, arg},
      # Start to serve requests, typically the last entry
      YPhoenixWeb.Endpoint
    ]

    # See https://hexdocs.pm/elixir/Supervisor.html
    # for other strategies and supported options
    opts = [strategy: :one_for_one, name: YPhoenix.Supervisor]
    Supervisor.start_link(children, opts)
  end

  # Tell Phoenix to update the endpoint configuration
  # whenever the application is updated.
  @impl true
  def config_change(changed, _new, removed) do
    YPhoenixWeb.Endpoint.config_change(changed, removed)
    :ok
  end
end
