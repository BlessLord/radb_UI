import subprocess
import logging
import json
import importlib

from sqlalchemy import engine, create_engine, inspect, text
import sqlalchemy.types
import sqlalchemy.exc

from radb.typesys import ValType

def sqltype_to_ratype(sqltype):
    if isinstance(sqltype, sqlalchemy.types.Boolean):
        return ValType.BOOLEAN
    elif isinstance(sqltype, sqlalchemy.types.Integer) or\
         isinstance(sqltype, sqlalchemy.types.Numeric):
        return ValType.NUMBER
    elif isinstance(sqltype, sqlalchemy.types.String):
        return ValType.STRING
    elif isinstance(sqltype, sqlalchemy.types.Date):
        return ValType.DATE
    elif isinstance(sqltype, sqlalchemy.types.DateTime):
        return ValType.DATETIME
    else:
        return ValType.UNKNOWN

class DB:

    def __init__(self, configured, resultprinter, prefix='db.'):
        props = { key[len(prefix):] : configured[key]\
                  for key in configured if key.startswith(prefix) }
        self.engine = create_engine(engine.url.URL.create(**props))
        self.inspector = inspect(self.engine)
        self.conn = self.engine.connect()
        self.resultprinter = resultprinter

    def list(self):
        return self.inspector.get_table_names()

    def table_exists(self, table):
        # safer than comparing against self.list() because it seems to
        # respect the case-sensivitity convention of the dbms.
        return self.engine.dialect.has_table(self.conn, table)

    def describe(self, table):
        attrs = list()
        for d in self.inspector.get_columns(table):
            attrs.append((d['name'], sqltype_to_ratype(d['type'])))
        return attrs

    def execute(self, query, **kwargs):
        try:
            result = self.conn.execute(text(query), **kwargs)
            self.conn.commit()
        except sqlalchemy.exc.DatabaseError:
            conn = self.engine.connect()
            result = self.conn.execute(text(query), **kwargs)
        return result

    def execute_and_print_result(self, query, attrs, **kwargs):
        result = self.execute(query, **kwargs)
        self.conn.commit()
        if result.returns_rows:
            print(self.resultprinter.print(result, attrs))
        else:
            print('done')
