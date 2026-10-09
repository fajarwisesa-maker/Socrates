"""Minimal OData V4 query support: $filter, $select, $top, $orderby and the JSON envelope.

$filter grammar (enough for the agent's queries, deliberately small):

    expr   := term ('or' term)*
    term   := factor ('and' factor)*
    factor := 'not' factor | '(' expr ')' | func | Field op literal
    func   := contains|startswith|endswith '(' Field ',' literal ')'
    op     := eq | ne | gt | ge | lt | le
    literal:= 'string' | number | true | false | null | 2026-10-10T03:00:00Z | 2026-10-10

Unquoted date/datetime literals are compared as normalised ISO strings, which is correct
because the store keeps every timestamp in the same UTC "YYYY-MM-DDTHH:MM:SSZ" form.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from typing import Any

Row = dict[str, Any]
Predicate = Callable[[Row], bool]


class ODataError(ValueError):
    """Bad query option; rendered as HTTP 400 with an OData error body."""


_TOKEN = re.compile(
    r"\s*(?:"
    r"(?P<str>'(?:[^']|'')*')"
    r"|(?P<dt>\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?)"
    r"|(?P<num>-?\d+(?:\.\d+)?)"
    r"|(?P<punct>[(),])"
    r"|(?P<word>[A-Za-z_][A-Za-z0-9_/]*)"
    r")"
)

_OPS = {
    "eq": lambda a, b: a == b,
    "ne": lambda a, b: a != b,
    "gt": lambda a, b: a is not None and b is not None and a > b,
    "ge": lambda a, b: a is not None and b is not None and a >= b,
    "lt": lambda a, b: a is not None and b is not None and a < b,
    "le": lambda a, b: a is not None and b is not None and a <= b,
}

_FUNCS = {
    "contains": lambda a, b: isinstance(a, str) and b in a,
    "startswith": lambda a, b: isinstance(a, str) and a.startswith(b),
    "endswith": lambda a, b: isinstance(a, str) and a.endswith(b),
}


def _normalise_dt(s: str) -> str:
    from siaga_common.timeline import from_iso, to_iso

    if "T" not in s:
        return s  # plain date
    if not re.search(r"(Z|[+-]\d{2}:\d{2})$", s):
        s += "Z"
    return to_iso(from_iso(s))


def _tokenise(text: str) -> list[tuple[str, Any]]:
    tokens: list[tuple[str, Any]] = []
    pos = 0
    text = text.strip()
    while pos < len(text):
        m = _TOKEN.match(text, pos)
        if not m or m.end() == pos:
            raise ODataError(f"cannot parse $filter near: {text[pos : pos + 20]!r}")
        pos = m.end()
        kind = m.lastgroup
        val = m.group(kind)
        if kind == "str":
            tokens.append(("lit", val[1:-1].replace("''", "'")))
        elif kind == "dt":
            tokens.append(("lit", _normalise_dt(val)))
        elif kind == "num":
            tokens.append(("lit", float(val) if "." in val else int(val)))
        elif kind == "word" and val in ("true", "false", "null"):
            tokens.append(("lit", {"true": True, "false": False, "null": None}[val]))
        else:
            tokens.append((kind, val))
    return tokens


class _Parser:
    def __init__(self, tokens: list[tuple[str, Any]]):
        self.toks = tokens
        self.i = 0

    def peek(self) -> tuple[str, Any] | None:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self, kind: str | None = None, value: str | None = None) -> tuple[str, Any]:
        tok = self.peek()
        if tok is None or (kind and tok[0] != kind) or (value and tok[1] != value):
            raise ODataError(f"unexpected token {tok!r} in $filter (wanted {value or kind})")
        self.i += 1
        return tok

    def is_word(self, value: str) -> bool:
        tok = self.peek()
        return tok is not None and tok[0] == "word" and tok[1] == value

    def parse(self) -> Predicate:
        pred = self.expr()
        if self.peek() is not None:
            raise ODataError(f"trailing tokens in $filter: {self.toks[self.i :]!r}")
        return pred

    def expr(self) -> Predicate:
        preds = [self.term()]
        while self.is_word("or"):
            self.take()
            preds.append(self.term())
        return preds[0] if len(preds) == 1 else (lambda r: any(p(r) for p in preds))

    def term(self) -> Predicate:
        preds = [self.factor()]
        while self.is_word("and"):
            self.take()
            preds.append(self.factor())
        return preds[0] if len(preds) == 1 else (lambda r: all(p(r) for p in preds))

    def factor(self) -> Predicate:
        if self.is_word("not"):
            self.take()
            inner = self.factor()
            return lambda r: not inner(r)
        tok = self.peek()
        if tok == ("punct", "("):
            self.take()
            inner = self.expr()
            self.take("punct", ")")
            return inner
        _, name = self.take("word")
        if name in _FUNCS:
            self.take("punct", "(")
            _, field = self.take("word")
            self.take("punct", ",")
            _, lit = self.take("lit")
            self.take("punct", ")")
            fn = _FUNCS[name]
            return lambda r: fn(r.get(field), lit)
        _, op = self.take("word")
        if op not in _OPS:
            raise ODataError(f"unsupported operator {op!r}")
        _, lit = self.take("lit")
        cmp = _OPS[op]
        field = name
        return lambda r: _safe(cmp, r.get(field), lit)


def _safe(cmp: Callable[[Any, Any], bool], a: Any, b: Any) -> bool:
    try:
        return cmp(a, b)
    except TypeError:
        return False


def parse_filter(text: str | None) -> Predicate:
    if not text or not text.strip():
        return lambda r: True
    return _Parser(_tokenise(text)).parse()


def apply_query(
    rows: list[Row],
    *,
    filter_: str | None = None,
    select: str | None = None,
    top: int | None = None,
    orderby: str | None = None,
) -> list[Row]:
    pred = parse_filter(filter_)
    out = [r for r in rows if pred(r)]
    if orderby:
        for part in reversed([p.strip() for p in orderby.split(",") if p.strip()]):
            field, _, direction = part.partition(" ")
            # OData: null sorts lower than any value.
            out.sort(
                key=lambda r: (False, 0) if r.get(field) is None else (True, r.get(field)),
                reverse=direction.strip().lower() == "desc",
            )
    if top is not None:
        if top < 0:
            raise ODataError("$top must be >= 0")
        out = out[:top]
    if select:
        fields = [f.strip() for f in select.split(",") if f.strip()]
        out = [{f: r.get(f) for f in fields} for r in out]
    return out


def collection(entity_set: str, rows: list[Row]) -> dict[str, Any]:
    return {"@odata.context": f"$metadata#{entity_set}", "value": rows}


def entity(entity_set: str, row: Row) -> dict[str, Any]:
    return {"@odata.context": f"$metadata#{entity_set}/$entity", **row}


def error(code: str, message: str) -> dict[str, Any]:
    return {"error": {"code": code, "message": message}}
