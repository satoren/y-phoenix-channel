defmodule YPhoenixWeb.YDocRoomChannelTest do
  use YPhoenixWeb.ChannelCase

  setup do
    {:ok, _, socket} =
      YPhoenixWeb.UserSocket
      |> socket("user_id", %{some: :assign})
      |> subscribe_and_join(YPhoenixWeb.YDocRoomChannel, "y_doc_room:lobby")

    %{socket: socket}
  end
end
