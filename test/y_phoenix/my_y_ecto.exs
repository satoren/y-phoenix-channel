defmodule YPhoenix.YEctoTest do
  use YPhoenix.DataCase, async: true

  alias YPhoenix.MyYEcto

  test "renders 500.html" do
    doc = MyYEcto.get_y_doc("test")

    array = Yex.Doc.get_array(doc, "array")
    Yex.Doc.monitor_update(doc)

    for _ <- 1..1000 do
      Yex.Array.push(array, "test")
      assert_receive {:update_v1, update, _origin, _ydoc}
      MyYEcto.insert_update("test", update)
    end

    doc = MyYEcto.get_y_doc("test")
    assert Yex.Array.length(Yex.Doc.get_array(doc, "array")) == 1000

    doc = MyYEcto.get_y_doc("test")
    assert Yex.Array.length(Yex.Doc.get_array(doc, "array")) == 1000
  end
end
