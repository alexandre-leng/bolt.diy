"""Exercise the isolated host patch, never the production route or paid provider.

Run with the existing screenshot-api virtualenv (no installation required):
PYTHONDONTWRITEBYTECODE=1 /opt/bolt/vendor/screenshot-to-code/backend/.venv/bin/python \
    -m pytest -p no:cacheprovider host-patches/screenshot-backend/tests -q
"""
import importlib.util
from pathlib import Path
import sys
from unittest.mock import Mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

# Only dependencies come from production; the route under test is always our copy.
BACKEND = Path('/opt/bolt/vendor/screenshot-to-code/backend')
sys.path.insert(0, str(BACKEND))
ROUTE = Path(__file__).resolve().parents[1] / 'routes' / 'designs.py'
spec = importlib.util.spec_from_file_location('isolated_designs', ROUTE)
assert spec is not None and spec.loader is not None
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)


@pytest.fixture
def api(monkeypatch):
    provider = Mock(return_value='data:image/png;base64,bW9jaw==')
    monkeypatch.setattr(module, 'INTERNAL_TOKEN', 'isolated-test-token')
    monkeypatch.setattr(module, 'is_available', Mock(return_value=True))
    monkeypatch.setattr(module, 'access_token', Mock(return_value='mock-oauth-token'))
    monkeypatch.setattr(module, 'generate_image_data_url_sync', provider)
    app = FastAPI()
    app.include_router(module.router)
    with TestClient(app) as client:
        yield client, provider


def post(client, **fields):
    return client.post('/api/internal/designs', json={'prompt': 'A coffee shop website', **fields},
                       headers={'x-internal-token': 'isolated-test-token'})


def test_progressive_requests_select_distinct_directions(api):
    client, provider = api
    for direction_index in range(4):
        response = post(client, count=1, directionIndex=direction_index)
        assert response.status_code == 200, response.text
        assert response.json()['images'] == ['data:image/png;base64,bW9jaw==']
        assert f'Style direction: {module.DIRECTIONS[direction_index]}.' in provider.call_args.args[0]
    assert provider.call_count == 4
    assert len({call.args[0] for call in provider.call_args_list}) == 4
    assert all(call.kwargs == {'token': 'mock-oauth-token'} for call in provider.call_args_list)


@pytest.mark.parametrize('fields,expected_count', [({}, 3), ({'count': 1}, 1), ({'count': 4}, 4)])
def test_omitted_direction_index_preserves_legacy_defaults(api, fields, expected_count):
    client, provider = api
    response = post(client, **fields)
    assert response.status_code == 200, response.text
    assert module.DesignRequest(prompt='legacy').directionIndex == 0
    assert len(response.json()['images']) == expected_count
    for index, call in enumerate(provider.call_args_list):
        assert f'Style direction: {module.DIRECTIONS[index]}.' in call.args[0]
    assert provider.call_count == expected_count


@pytest.mark.parametrize('direction_index,count', [(offset, count) for offset in range(4)
                                                   for count in range(1, 5 - offset)])
def test_valid_ranges_generate_consecutive_directions(api, direction_index, count):
    client, provider = api
    response = post(client, count=count, directionIndex=direction_index)
    assert response.status_code == 200, response.text
    assert provider.call_count == count
    for index, call in enumerate(provider.call_args_list):
        assert f'Style direction: {module.DIRECTIONS[direction_index + index]}.' in call.args[0]


@pytest.mark.parametrize('direction_index', [-1, 4, 999, '1', 1.0, 1.5, True, False, None, [], {}])
def test_direction_index_rejects_invalid_types_and_bounds(api, direction_index):
    client, provider = api
    response = post(client, count=1, directionIndex=direction_index)
    assert response.status_code == 422, response.text
    provider.assert_not_called()
    module.access_token.assert_not_called()


@pytest.mark.parametrize('direction_index,count', [(1, 4), (2, 3), (3, 2), (3, 4)])
def test_direction_range_must_not_exceed_four(api, direction_index, count):
    client, provider = api
    response = post(client, count=count, directionIndex=direction_index)
    assert response.status_code == 422, response.text
    provider.assert_not_called()
    module.access_token.assert_not_called()
