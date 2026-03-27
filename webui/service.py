from __future__ import annotations

import configparser
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import sqlalchemy.exc

from radb.ast import Context, ExecutionError, RelExpr, ValidationError
from radb.db import DB
from radb.parse import ParsingError, statements_from_string
from radb.typesys import TypeSysError, ValTypeChecker
from radb.views import ViewCollection


class QueryServiceError(Exception):
    """Raised when the web UI cannot prepare or run a query."""


class _SilentResultPrinter:
    def print(self, result, attrs):
        return ""


def _build_configured_settings(db_path: Path) -> dict[str, str]:
    root_dir = Path(__file__).resolve().parent.parent

    system_config = configparser.ConfigParser()
    system_config.read(root_dir / "radb" / "sys.ini")

    sqlite_config = configparser.ConfigParser()
    sqlite_config.read(root_dir / "sample" / "sqlite.ini")

    configured = dict(system_config.items(configparser.DEFAULTSECT))
    configured.update(dict(sqlite_config.items(configparser.DEFAULTSECT)))
    configured["db.database"] = str(db_path)
    return configured


def _serialize_value(value: Any) -> Any:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return str(value)


class RadbService:
    def __init__(self, db_path: Path):
        self.db_path = db_path.resolve()
        if not self.db_path.exists():
            raise QueryServiceError(f"database file not found: {self.db_path}")

        self.configured = _build_configured_settings(self.db_path)
        try:
            self.checker = ValTypeChecker(
                self.configured["default_functions"],
                self.configured.get("functions"),
            )
            self.db = DB(self.configured, _SilentResultPrinter())
        except (TypeSysError, KeyError, Exception) as exc:
            raise QueryServiceError(f"failed to initialize radb: {exc}") from exc

    def schema_payload(self) -> dict[str, Any]:
        relations = []
        for relation_name in sorted(self.db.list()):
            columns = []
            for column_name, column_type in self.db.describe(relation_name):
                columns.append(
                    {
                        "name": column_name,
                        "type": column_type.value,
                    }
                )
            relations.append({"name": relation_name, "columns": columns})

        return {
            "database_path": str(self.db_path),
            "relations": relations,
        }

    def execute_query(self, raw_query: str) -> dict[str, Any]:
        query = raw_query.strip()
        if not query:
            raise QueryServiceError("enter a relational algebra query before running it")
        if not query.endswith(";"):
            query += ";"

        try:
            statements = statements_from_string(query)
        except ParsingError as exc:
            raise QueryServiceError(str(exc)) from exc

        if len(statements) != 1:
            raise QueryServiceError("the web UI runs one relational algebra statement at a time")

        statement = statements[0]
        context = Context(self.configured, self.db, self.checker, ViewCollection())

        try:
            statement.validate(context)
        except (ValidationError, ExecutionError) as exc:
            raise QueryServiceError(str(exc)) from exc

        if not isinstance(statement, RelExpr):
            raise QueryServiceError(
                "only relational algebra expressions that return a relation are supported here"
            )

        sql_query = self._compile_sql(statement)

        try:
            result = self.db.execute(sql_query)
            rows = [
                [_serialize_value(value) for value in row]
                for row in result.fetchall()
            ]
        except sqlalchemy.exc.SQLAlchemyError as exc:
            raise QueryServiceError(f"SQL error in translated query:\n{sql_query}\n{exc}") from exc

        columns = [
            {
                "name": attr.name or f"col{index + 1}",
                "type": attr.type.value,
            }
            for index, attr in enumerate(statement.type.attrs)
        ]

        return {
            "query": query,
            "sql": sql_query,
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
            "message": "no tuples returned" if not rows else f"{len(rows)} tuple(s) returned",
        }

    @staticmethod
    def _compile_sql(statement: RelExpr) -> str:
        blocks = [block for block in statement.sql()]
        if not blocks:
            raise QueryServiceError("radb did not generate SQL for the query")
        return "WITH " + ",\n     ".join(blocks) + f"\nSELECT * FROM {statement.type.sql_rel()}"
