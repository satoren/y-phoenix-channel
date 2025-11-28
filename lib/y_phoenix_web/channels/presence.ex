defmodule YPhoenixWeb.Presence do
  use Phoenix.Presence,
    otp_app: :y_phoenix,
    pubsub_server: YPhoenix.PubSub

  def init(_opts) do
    {:ok, %{}}
  end

  def fetch(_topic, presences) do
    for {key, %{metas: [meta | metas]}} <- presences, into: %{} do
      {key, %{metas: [meta | metas]}}
    end
  end

  def handle_metas(topic, %{joins: joins, leaves: leaves}, presences, state) do
    for {user_id, presence} <- joins do
      user_data = %{id: user_id, metas: Map.fetch!(presences, user_id)}
      msg = {__MODULE__, {:join, user_data}}
      Phoenix.PubSub.local_broadcast(YPhoenix.PubSub, "proxy:#{topic}", msg)
    end

    for {user_id, presence} <- leaves do
      metas =
        case Map.fetch(presences, user_id) do
          {:ok, presence_metas} -> presence_metas
          :error -> []
        end

      user_data = %{id: user_id, metas: metas}
      msg = {__MODULE__, {:leave, user_data}}
      Phoenix.PubSub.local_broadcast(YPhoenix.PubSub, "proxy:#{topic}", msg)
    end

    {:ok, state}
  end

  def list_users(topic), do: list(topic) |> Enum.map(fn {_id, presence} -> presence end)
  def track_user(topic, name, params), do: track(self(), topic, name, params)
  def subscribe(topic), do: Phoenix.PubSub.subscribe(YPhoenix.PubSub, "proxy:#{topic}")
end
