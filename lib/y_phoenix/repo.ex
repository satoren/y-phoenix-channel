defmodule YPhoenix.Repo do
  use Ecto.Repo,
    otp_app: :y_phoenix,
    adapter: Ecto.Adapters.Postgres
end
