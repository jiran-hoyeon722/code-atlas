from shop.api import views


def test_list_items():
    assert views.list_items(None) == []
