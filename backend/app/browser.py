"""In-browser entry point (Pyodide / WebAssembly).

The static website runs the same FastAPI route functions as the server, but
without an ASGI server: requests are matched against the router, parameters
are validated with Pydantic exactly as FastAPI would, and the endpoint is
called directly. Errors are mapped to the same status codes and payloads as
``app.main``. Data mode is forced to ``snapshot`` because browsers cannot call
the Treasury/FRED download endpoints (no CORS); the bundled snapshot is
labeled accordingly in every response.
"""
from __future__ import annotations

import inspect
import json
import os
import typing
from urllib.parse import parse_qs

os.environ["MONETARY_DATA_MODE"] = "snapshot"

from fastapi import Response  # noqa: E402
from fastapi.encoders import jsonable_encoder  # noqa: E402
from fastapi.params import Param  # noqa: E402
from pydantic import BaseModel, TypeAdapter, ValidationError  # noqa: E402
from pydantic_core import PydanticUndefined  # noqa: E402
from starlette.routing import Match  # noqa: E402

from app.api.routes import router  # noqa: E402
from app.data.sources import DataSourceError  # noqa: E402
from app.data.store import DataUnavailable  # noqa: E402

_HINTS: dict = {}


def _hints(fn) -> dict:
    if fn not in _HINTS:
        _HINTS[fn] = typing.get_type_hints(fn)
    return _HINTS[fn]


def _error(status: int, detail) -> tuple[int, str, str]:
    return status, "application/json", json.dumps({"detail": detail})


def handle(method: str, path: str, query: str = "", body: str | None = None) -> tuple[int, str, str | bytes]:
    """Dispatch one request. Returns (status, content_type, payload)."""
    scope = {"type": "http", "path": path, "method": method.upper(), "root_path": "", "query_string": b""}
    route = None
    path_params: dict = {}
    for r in router.routes:
        match, child = r.matches(scope)
        if match == Match.FULL:
            route, path_params = r, child.get("path_params", {})
            break
    if route is None:
        return _error(404, "Not Found")

    fn = route.endpoint
    hints = _hints(fn)
    q = {k: v[-1] for k, v in parse_qs(query, keep_blank_values=False).items()}
    kwargs: dict = {}
    try:
        for name, p in inspect.signature(fn).parameters.items():
            ann = hints.get(name, str)
            if inspect.isclass(ann) and issubclass(ann, BaseModel):
                payload = json.loads(body) if body else {}
                try:
                    kwargs[name] = ann.model_validate(payload)
                except ValidationError as e:
                    errs = e.errors(include_url=False, include_context=False)
                    for err in errs:
                        err["loc"] = ("body", *err["loc"])
                    return _error(422, jsonable_encoder(errs))
                continue
            default = p.default
            alias, fallback = name, default
            if isinstance(default, Param):
                alias = default.alias or name
                fallback = default.default
            if name in path_params:
                raw = path_params[name]
            elif alias in q:
                raw = q[alias]
            elif fallback is not PydanticUndefined and fallback is not inspect.Parameter.empty:
                kwargs[name] = fallback
                continue
            else:
                return _error(422, [{"loc": ["query", alias], "msg": "Field required", "type": "missing"}])
            try:
                kwargs[name] = TypeAdapter(ann).validate_python(raw)
            except ValidationError as e:
                errs = e.errors(include_url=False, include_context=False)
                for err in errs:
                    err["loc"] = ("query", alias, *err["loc"])
                return _error(422, jsonable_encoder(errs))
        result = fn(**kwargs)
    except DataUnavailable as e:
        return _error(404, str(e))
    except ValueError as e:
        return _error(422, str(e))
    except KeyError as e:
        return _error(404, f"not found: {e.args[0] if e.args else e}")
    except DataSourceError as e:
        return _error(503, f"data source unavailable: {e}")
    if isinstance(result, Response):
        return result.status_code, result.media_type or "application/octet-stream", bytes(result.body)
    return 200, "application/json", json.dumps(jsonable_encoder(result))
