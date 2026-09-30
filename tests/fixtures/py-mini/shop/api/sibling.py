import requests
from .missing import thing


def items():
    try:
        return requests.get("http://example.invalid").json()
    except ValueError:
        return []
