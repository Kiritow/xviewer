# UniCon: United Connections (for databases)

import MySQLdb
import json
import os
import sqlite3
from UniLog import UniLog

VERSION = "UniCon 1.6 (OpenSource Version)"
VERSION_ID = 20210827001

class UniDefaultInvoker(object):
    def __init__(self):
        pass

    def get_names(self, instance_name, db_name):
        return instance_name, db_name

    def get_config(self, config_path):
        return config_path


class UniTransaction(object):
    def __init__(self, uni_con, auto_commit):
        self.uni_con = uni_con
        self.auto_commit = auto_commit

    def commit(self, no_delay=False):
        if self.auto_commit and not no_delay:
            self.uni_con.logger.info("UniTransaction: Auto commit enabled and no delay set. Skip committing here.")
        else:
            self.uni_con.commit()

    def __enter__(self):
        self.uni_con.logger.info("UniTransaction: Begin transaction.")

    def __exit__(self, exc_type, exc_value, exc_tb):
        if exc_tb is not None:
            self.uni_con.logger.info("UniTransaction: Exception detected, start rollback.")
            self.uni_con.rollback()
        elif self.auto_commit:
            self.uni_con.logger.info("UniTransaction: Leave transaction with auto commit enabled, start commiting...")
            self.uni_con.commit()
        else:
            self.uni_con.logger.info("UniTransaction: Leave transaction, start rollback.")
            self.uni_con.rollback()


class UniCon(object):
    @staticmethod
    def from_mysql(mysql_conn,
                   logger=None, cursor_type="dict",
                   managed=False):
        conn = UniCon("", _blankInit=True)
        conn._managed = managed
        conn.instance_name = "<MySQL>"
        conn._host = "<existing_connection>"
        conn.logger = logger if logger is not None else UniLog()
        conn.conn = mysql_conn
        if cursor_type == "dict":
            conn.cursor = mysql_conn.cursor(MySQLdb.cursors.DictCursor)
        else:
            conn.cursor = mysql_conn.cursor()
        conn.conn_type = "mysql"
        return conn

    @staticmethod
    def connect_mysql(host, port, username, password, database, charset="utf8"):
        return UniCon.from_mysql(MySQLdb.connect(host=host, port=port, user=username, passwd=password, db=database, charset=charset))

    def _do_create_db_conn(self, config_file, instance_name, db_name=None, cursor_type="dict"):
        try:
            with open(config_file, "r") as f:
                content_raw = f.read()
            instance_config = json.loads(content_raw)
        except Exception:
            raise Exception("Cannot find UniCon configure file in: {}.".format(config_file))

        if instance_name not in instance_config:
            raise Exception("Unknown instance name: {}".format(instance_name))

        self._host = instance_config[instance_name]['host']
        self.logger.info("Opening connection to instance: {} ({})...".format(instance_name, self._host))

        conn = MySQLdb.connect(db=db_name, **instance_config[instance_name])
        if cursor_type == "dict":
            cursor = conn.cursor(MySQLdb.cursors.DictCursor)
        else:
            cursor = conn.cursor()  # By default, MySQldb use class Cursor. (returns rows as tuples and stores the result set in the client)

        return conn, cursor

    def _do_create_sqlite3_conn(self, full_path):
        conn = sqlite3.connect(full_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        self.logger.info("Opened database from file: {}".format(full_path))
        return conn, cursor

    def _do_create_file_db_conn(self, db_name, file_path):
        if file_path:
            try:
                return self._do_create_sqlite3_conn(file_path)
            except Exception as e:
                self.logger.warn(e)

            if db_name:
                try:
                    return self._do_create_sqlite3_conn(os.path.join(file_path, db_name + ".db"))
                except Exception as e:
                    self.logger.warn(e)

                try:
                    return self._do_create_sqlite3_conn(os.path.join(file_path, db_name))
                except Exception as e:
                    self.logger.warn(e)
        else:
            try:
                return self._do_create_sqlite3_conn(db_name + ".db")
            except Exception as e:
                self.logger.warn(e)

            try:
                return self._do_create_sqlite3_conn(db_name)
            except Exception as e:
                self.logger.warn(e)

        raise Exception("No candidate sqlite3 database file found.")

    def __init__(self, instance_name, db_name=None, file_path=None,  # Connection params
                 invoker=None, skip_ui_check=False,  # UniCon settings
                 logger=None, cursor_type="dict", config_path=None,  # Basic settings
                 _blankInit=False):
        '''
        Opening connection to database (MySQL, SQLite3)
        If instance_name is None, this connection is regarded as a SQLite3 connection, and filename will be read from db_name and file_path.
        UniCon will find sqlite3 database file in the following order:
            1. Open file_path directly if it presents.
            2. Open file_path + db_name + ".db" if both presents.
            3. Open file_path + db_name, if both presents.
            4. Open db_name + ".db" if db_name presents.
            5. Open db_name if db_name presents.
            Otherwise, an exception will be raised.
        '''

        if _blankInit:
            self._managed = False
            return
        else:
            self._managed = True

        self.logger = logger if logger is not None else UniLog()

        if invoker:
            self.logger.info("UniCon: Invoker present.")
            self.instance_name, db_name = invoker.get_names(instance_name, db_name)  # db_name will not be stored in self.
            config_path = invoker.get_config(config_path)
            self.logger.info("UniCon: Invoker set names to: ({}, {})".format(self.instance_name, db_name))
        else:
            self.instance_name = instance_name

        if db_name.endswith('_formal') and not skip_ui_check:
            raw_input("Formal database detected. Need interactive check. Press ENTER to continue or Ctrl+C to abort.")

        if instance_name is None or instance_name == "":
            self.conn, self.cursor = self._do_create_file_db_conn(db_name, file_path)
            self.conn_type = "sqlite3"
        else:
            self.conn, self.cursor = self._do_create_db_conn(config_path, self.instance_name, db_name=db_name, cursor_type=cursor_type)
            self.conn_type = "mysql"

    def __del__(self):
        if self._managed:
            self.conn.close()
            self.logger.info("Connection to instance closed: {} ({})".format(self.instance_name, self._host))

    def new_transaction(self, auto_commit=False):
        return UniTransaction(self, auto_commit)

    def _check_params(self, params, output=True):
        if params is not None and type(params) is not list:
            raise Exception("Invalid params type: {}".format(type(params)))
        if output and params:
            self.logger.info(params)

    def execute(self, sql, params=None):
        self.logger.info(sql)
        self._check_params(params)
        return self.cursor.execute(sql, params)

    def executemany(self, sql, params):
        self.logger.info(sql)
        self._check_params(params, output=False)
        return self.cursor.executemany(sql, params)

    def query(self, sql, params=None):
        self.logger.info(sql)
        self._check_params(params)
        self.cursor.execute(sql, params)
        return self.cursor.fetchall()

    def commit(self):
        self.logger.debug("UniCon: Commiting...")
        self.conn.commit()

    def rollback(self):
        self.logger.debug("UniCon: Rollback.")
        self.conn.rollback()

    def get_last_rowid(self):
        self.logger.warn("get_last_rowid() is deprecated and will be removed in future. Use lastrowid instead.")
        return self.cursor.lastrowid

    @property
    def lastrowid(self):
        return self.cursor.lastrowid

    @property
    def rowcount(self):
        return self.cursor.rowcount

    # Helper Functions
    def query_one(self, sql, params=None):
        result = self.query(sql, params)
        if result:
            return result[0]
        else:
            return None

    def insert_into(self, table_name, sql_fields):
        table_struct = sorted(sql_fields.keys())
        return self.execute("insert into {}({}) values ({})".format(table_name, ','.join(table_struct), ','.join(["%s"] * len(table_struct))),
                            [sql_fields[k] for k in table_struct])

    def insert_many(self, table_name, sql_fields_arr):
        table_struct = sorted(sql_fields_arr[0].keys())
        return self.executemany("insert into {}({}) values ({})".format(table_name, ','.join(table_struct), ','.join(["%s"] * len(table_struct))),
                                [tuple([sql_fields[k] for k in table_struct]) for sql_fields in sql_fields_arr])

    def get_table_struct(self, table_name):
        return self.query("desc {}".format(table_name))


if __name__ == "__main__":
    # logging.basicConfig(level=logging.INFO)
    conn = UniCon("localhost", "wordpress", invoker=UniDefaultInvoker())
    print conn.query("select count(1) as 'total' from dm_posts")[0]
    with conn.new_transaction() as t:
        conn.execute("delete from dm_posts")
        print conn.query("select count(1) as 'total' from dm_posts")[0]
        raise Exception("ROLLBACK")
    print conn.query("select count(1) as 'total' from dm_posts")[0]
