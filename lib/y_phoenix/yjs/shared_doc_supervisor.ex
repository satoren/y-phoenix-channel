defmodule YPhoenix.SharedDocSupervisor do
  @moduledoc """
  """

  alias YPhoenix.SharedDoc
  use Supervisor

  defmodule SharedDocLocalPubsub do
    @behaviour YPhoenix.SharedDoc.LocalPubSub

    def monitor_count(doc_name) do
      Registry.lookup(__MODULE__, doc_name) |> Enum.count()
    end

    def broadcast(doc_name, message, exclude_origin) do
      Registry.dispatch(__MODULE__, doc_name, fn entries ->
        entries
        |> Enum.reject(fn {_pid, origin} -> origin === exclude_origin end)
        |> Enum.each(fn {pid, _origin} -> send(pid, message) end)
      end)
    end

    def monitor(doc_name) do
      {:ok, _} = Registry.register(__MODULE__, doc_name, "#{inspect(self())}")
      :ok
    end

    def demonitor(doc_name) do
      :ok = Registry.unregister(__MODULE__, doc_name)
    end
  end

  @registry YPhoenix.SharedDocSupervisor.SharedDocRegistry
  @local_pubsub YPhoenix.SharedDocSupervisor.SharedDocLocalPubsub
  @dynamic_supervisor YPhoenix.SharedDocSupervisor.DynamicSupervisor

  def start_link(init_arg) do
    Supervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(init_arg) do
    pg_scope = Keyword.get(init_arg, :pg_scope, YPhoenix.SharedDocScope)

    children = [
      %{
        id: :pg,
        start: {:pg, :start_link, [pg_scope]}
      },
      {Registry, keys: :unique, name: @registry},
      {Registry, keys: :duplicate, name: @local_pubsub},
      {@dynamic_supervisor, [local_pubsub: @local_pubsub] ++ init_arg}
    ]

    Supervisor.init(children, strategy: :one_for_one)
  end

  def start_child(doc_name) do
    name = via_name(doc_name)

    @dynamic_supervisor.start_child(doc_name: doc_name, name: name)

    try do
      # check started
      SharedDoc.doc_name(name)
    catch
      _ ->
        @dynamic_supervisor.start_child(doc_name: doc_name, name: name)
    end

    {:ok, name}
  end

  def via_name(doc_name) do
    {:via, Registry, {@registry, doc_name}}
  end

  defdelegate monitor_shared_doc_update(doc_name), to: @local_pubsub, as: :monitor
  defdelegate demonitor_shared_doc_update(doc_name), to: @local_pubsub, as: :demonitor
  defdelegate monitor_count(doc_name), to: @local_pubsub

  defdelegate broadcast_shared_doc_update(doc_name, message, exclude_origin),
    to: @local_pubsub,
    as: :broadcast
end

defmodule YPhoenix.SharedDocSupervisor.DynamicSupervisor do
  use DynamicSupervisor

  defmodule ChildSpec do
    def start_link(extra_arguments, option) do
      name = Keyword.fetch!(option, :name)
      option = option |> Keyword.delete(:name)
      YPhoenix.SharedDoc.start_link(option ++ extra_arguments, name: name)
    end

    def child_spec(opts) do
      %{
        id: YPhoenix.SharedDoc,
        start: {__MODULE__, :start_link, [opts]}
      }
    end
  end

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  def start_child(args) do
    spec = {
      ChildSpec,
      args
    }

    DynamicSupervisor.start_child(__MODULE__, spec)
  end

  @impl true
  def init(init_arg) do
    DynamicSupervisor.init(
      strategy: :one_for_one,
      extra_arguments: [init_arg]
    )
  end
end
