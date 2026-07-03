import time
import datetime
import pyodbc
import json
import os
from pathlib import Path
from datetime import datetime, timezone, timedelta

class SQLClient:
    def __init__(self, pollParams):
        self.pollParams = pollParams


        self.sqltype = pollParams.get("protocol","")

        self.host = pollParams.get(self.sqltype).get("server","")
        self.port = pollParams.get(self.sqltype).get("port",-1)
        self.database = pollParams.get(self.sqltype).get("database",None)
        self.username = pollParams.get(self.sqltype).get("username",None)
        self.password = pollParams.get(self.sqltype).get("password",None)
        self.row_limit = pollParams.get(self.sqltype).get("rowlimit",None)
        self.driver = pollParams.get(self.sqltype).get("driver",None)
        self.offline_poll_count = pollParams.get(self.sqltype).get("offline_poll_count",None)
        self.default_last_read_time = pollParams.get(self.sqltype).get("default_last_read_time",170406720000)

        self.retry_count = pollParams.get("connectRetryCount", 3)
        self.interpoll_delay = pollParams.get("interPollDelay", 100) /1000
        self.retry_delay = pollParams.get("connectRetryTime", 1000) / 1000  # ms to seconds
        self.conn_type = pollParams.get("connectionType", None)
        self.conn_status = "disconnected"
        self.last_read_time = 0

        script_dir = Path(__file__).parent
        self.HISTORY_FILE = script_dir / "history.json"

        if not os.path.exists(self.HISTORY_FILE):
            history = { "last_read_time" : {}}
        else:
            with open(self.HISTORY_FILE, "r") as f:
                history = json.load(f)

        self.last_read_time = history["last_read_time"]


        self.TZ = timezone(timedelta(hours=5, minutes=30))

        if(self.conn_type == "persist" ):
            try:
                val = self.connect()
                print(val)
            except Exception as e:
                raise Exception(f"SQL Connect error: {e}")
        else:
            val = 0


        return


    def connect(self,**opts):

        if (self.host == "") or (self.port == -1):
            print("Hello")
            return False

        try:
            if self.sqltype == "mssql":
                driver = opts.get("driver", "ODBC Driver 18 for SQL Server")
                port = self.port or 1433
                conn_str = (
                    f"DRIVER={{{driver}}};SERVER={self.host},{self.port};DATABASE={self.database};"
                    f"UID={self.username};PWD={self.password};Encrypt=yes;TrustServerCertificate=yes;"
                )
            elif self.sqltype == "mysql":
                driver = opts.get("driver", "MySQL ODBC 9.4 Unicode Driver")
                port = self.port or 3306
                conn_str = (
                    f"DRIVER={{{driver}}};"
                    f"SERVER={self.host};PORT={port};DATABASE={self.database};"
                    f"UID={self.username};PWD={self.password};"
                    "OPTION=3;"                  # usual defaults (reconnect, etc.)
                    # "CHARSET=utf8mb4;"         # uncomment if you need explicit charset
                    # "SSLMODE=REQUIRED;"        # uncomment if you enforce SSL
                )
            else:
                return False


            #Add connection retry here
            success = False
            for attempt in range(self.retry_count):
                try:
                    self.conn = pyodbc.connect(conn_str)
                    success = True
                    break
                except Exception as e:
                    print(f"[SQL] Connection attempt {attempt + 1} failed: {e}")
                time.sleep(self.retry_delay)

            if success:
                self.conn_status = "connected"
                print(f"[SQL] Connected to {self.host}, {self.database}")
            else:
                self.conn_status = "disconnected"

        except Exception as e:
            success = False
            print(f"[SQL] Error in Connect Function: {e}")

        return success


    def disconnect(self):
        if self.conn:
            try:
                self.conn.close()
                self.conn = None
                self.conn_status = "disconnected"
                print("[SQL] Disconnected")
            except Exception as e:
                print(e)
        else:
            print("[SQL] client Object does not exist anymore")


    """
        Read a block and return decoded tags in a protocol-agnostic shape:

        [{
          "columns": [],
          "time": 1723923900,
          "tags":   [ {"tag": "<name>", "value": <value>}, ... ],
          "status": 1|0,
          "error":  None | "<message>"
        }]
    """

    def read(self,tablename,columns,tag_configs):
        try:


            if self.conn_status != "connected":
                if(self.connect()):
                    self.conn_status = "connected"
                else:
                    raise Exception(f"SQL not connected")

            packets = []
            column_str = ""
            i = 0
            index_found = None
            last_read_time =0


            for index, tag_config in enumerate(tag_configs):
                if tag_config["tagName"] == "ts":
                    index_found = index
                    break

            if index_found is None:
                raise Exception(f"Timestamp Column Not found")


            tablename = self._q(tablename)
            ts_col = self._q(columns[index_found])

            for col in columns:
                if i < len(columns)-1:
                    column_str = column_str + self._q(col) + ", "
                else:
                    column_str = column_str + self._q(col)
                i=i+1


            last_read_time = self.last_read_time.get(tablename,None)
            if last_read_time is None:
                last_read_time = self.default_last_read_time

            sql = self.get_row_count_query(tablename,ts_col)
            params = [self.datetime_from_epoch_ms(last_read_time)]

            #print(sql)
            #print(params)
            rows = {}
            if self.conn:
                cur = self.conn.cursor()
                cur.execute(sql, params)
                #print(cur.fetchall())
                row_count = cur.fetchall()[0][0]
                cur.close()

                if row_count > 0:
                    while (row_count>0):
                        print(f"{row_count} Unread rows since {last_read_time}")
                        rows = []
                        if row_count > self.row_limit:
                            count = self.row_limit
                        else:
                            count = row_count

                        sql = self.get_rows_query(tablename,column_str,ts_col,count)
                        params = [self.datetime_from_epoch_ms(last_read_time)]
                        #print(sql)
                        #print(params)

                        cur = self.conn.cursor()
                        cur.execute(sql, params)
                        data = cur.fetchall()
                        columns_recv = cur.description

                        print(f"Number of rows recv: {len(data)}")

                        if len(columns_recv) == len(columns) and len(columns) == len(data[0]):
                            rows = self.format_packet(data,columns,columns_recv,tag_configs)
                            #print(f"First row of batch {rows[0]}")
                            #print(f"Last row of batch {rows[len(rows)-1]}")
                        else:
                            raise Exception(f"Data not recieved correctly from SQL Server")
                        cur.close()

                        last_read_time = rows[len(rows)-1]["time"] + 4 #adding 4ms to avoid 3.33ms tick count in SQL databases
                        #print(last_read_time)
                        packets = packets+rows
                        row_count = row_count - count
                        time.sleep(self.interpoll_delay)

                    print(f"Read rows till {last_read_time}")
                    self.last_read_time[tablename] = last_read_time
                    self.saveHistory()
                    #print(f"timestamp of last data packet {rows[len(rows)-1]["time"]}")
                else:
                    rows["tags"] = []
                    rows["time"] = int(time.time()*1000)
                    rows["status"] = 2
                    packets = [rows]
                    print(f"No new rows since {last_read_time}")
            else:
                print("No SQL conn object")
                raise Exception(f"SQL read function error: No SQL conn object")


            if not self.conn_type == "persist":
                self.disconnect()
                
            return packets

        except Exception as e:
            raise Exception(f"SQL read function error: {e}")

    def get_row_count_query(self,tablename,ts_col):
        if self.sqltype == "mssql":
            sql =   (
                        f"SELECT COUNT(*) AS row_count "
                        f"FROM {tablename} "
                        f"WHERE {ts_col} > ?;"
                    )
            return sql
        elif self.sqltype == "mysql":
            sql =   (
                        f"SELECT COUNT(*) AS row_count "
                        f"FROM {tablename} "
                        f"WHERE {ts_col} > ?;"
                    )
            return sql
        else:
            raise Exception(f"Unsupported SQL Type")

    def get_rows_query(self,tablename, column_str, ts_col,count):
        if self.sqltype == "mssql":
            sql =   (
                        f"SELECT TOP ({count}) {column_str} FROM {tablename} "
                        f"WHERE {ts_col} > ? "
                        f"ORDER BY {ts_col} ASC"
                    )
            return sql
        elif self.sqltype == "mysql":
            sql = (
                f"SELECT {column_str} "
                f"FROM {tablename} "
                f"WHERE {ts_col} > ? "
                f"ORDER BY {ts_col} ASC "
                f"LIMIT {int(count)}"
            )
            return sql
        else:
            raise Exception(f"Unsupported SQL Type")

    def datetime_from_epoch_ms(self,ms: int) -> datetime:
    # build in UTC using integer math, then convert to IST (no float rounding)
        dt_utc = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=ms)
        return dt_utc.astimezone(self.TZ)


    def format_packet(self,data,columns,columns_recv,tagConfigs):
        ret_val = []
        packets = []
        for row in data:
            packet = {}
            packet["tags"] = []

            for col in columns_recv:
                #print(col)
                try:
                    index = columns.index(col[0])
                except Exception as e:
                    raise Exception(f"Column Name recieved does not match any configured Column Name")

                tagConfig = tagConfigs[index]
                if tagConfig["datatype"] != col[1].__name__:
                    raise Exception(f"Wrong Configured Data Type: {col[1].__name__} , {tagConfig["datatype"] }")
                else:

                    data_pt = row[index]
                    tagName = tagConfig["tagName"]
                    #if tagName == "D11":
                        #print(data_pt)
                    if tagName == "ts":
                        packet["time"] = int(data_pt.timestamp()*1000)
                    else:
                        packet["tags"].append({"tag" : tagName, "value" : data_pt})

            packet["status"] = 1
            packets.append(packet)

        return packets

    def saveHistory(self):
        try:

            history = {"last_read_time":self.last_read_time}
            with open(self.HISTORY_FILE, "w") as f:
                json.dump(history, f)
        except Exception as err:
            print(f"[E]Error in saving to History File: {err}")

    def _q(self, ident): # Safe quoting for identifiers you control (table/column names)
        if self.sqltype == "mssql":
            return f"[{ident}]"
        elif self.sqltype == "mysql":
            return f"{ident}"
        return ""