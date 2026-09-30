from . import sibling
from . import helper_fn
from ..core import x
import shop.models.order


def list_items(request):
    if request is None:
        return []
    return [helper_fn(i) for i in sibling.items() if i]
