from app.providers.text.deepseek import _loads_lenient


def test_plain_json():
    assert _loads_lenient('{"a": 1}') == {"a": 1}


def test_code_fence():
    assert _loads_lenient('```json\n{"a": 1}\n```') == {"a": 1}


def test_trailing_comma():
    assert _loads_lenient('{"a": 1, "b": [1, 2,],}') == {"a": 1, "b": [1, 2]}


def test_surrounding_prose():
    assert _loads_lenient('好的，结果如下：{"a": 1} 以上。') == {"a": 1}
