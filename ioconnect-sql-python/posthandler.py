import queue
import sqlite3
import random
import os
import requests as http
import paho.mqtt.client as mqtt
import time
import json
import threading
from pathlib import Path


class post_handler:
    def __init__(self, config, writeconfig):
        self.protocol = config["type"]
        self.writeconfig = writeconfig
        self.host = config["host"]
        self.port = config["port"]
        self.stringPosting = config["stringPosting"]
        self.stop_event = threading.Event()
        self.data_queue = queue.Queue()
        self.blocking = config["blocking"]

        if self.protocol == 'mqtt':
            self.keepalive = config["keepalive"]
            self.clientid = config["clientId"]
            self.username = config["username"]
            self.password = config["password"]
            self.qos = config["qos"]
            self.clientId = config["clientId"]
            if self.clientId == "":
                self.clientId = "MOD_FAC_" + str(random.randint(1000, 9999))

            mqttc = mqtt.Client(client_id=self.clientid, clean_session=True, protocol=mqtt.MQTTv311, transport="tcp")
            mqttc.username_pw_set(username=self.username, password=self.password)
            mqttc.on_connect = self.on_connect
            mqttc.on_message = self.on_message
            mqttc.connect(self.host, self.port, self.keepalive)
            self.mqttObj = mqttc

        elif self.protocol == "http":
            self.method = config["method"]
            self.path = config["path"]
            self.headers = config["headers"]
            self.timeout = config["timeout"] / 1000

        if (self.protocol == "mqtt") or (not self.blocking):
            self.bck_thread = threading.Thread(target=self.background)
            self.bck_thread.name = "post_background_handler"
            self.bck_thread.daemon = True
            self.bck_thread.start()

        self.dboverflow = 0
        #self.busy_q = que
        self.backupFile =  config["backupfile"]
        self.localbackup = config["localbackup"]
        if ((self.localbackup) and (self.backupFile is not None)):
            self.backupFile = Path(__file__).parent / self.backupFile
            self.create_db()

    def on_connect(self, client, userdata, flags, reason_code):
        print(f"MQTT Connected with result code {reason_code}")
        
    def on_message(self, client, userdata, msg):
        topic = msg.topic
        payload = msg.payload
        print(f"message {payload} recived on topic {topic}")
            

    def stringPayload(self,payload):
        dataItems = payload["data"]
        newData = []
        for item in dataItems:
            for key,value in item.items():
                if key == "value":
                    item[key] = f'{value}'
                    newData.append(item)
        payload["data"] = newData
        return payload

    def postOrBackup(self, payload):
        try:
            stat = 0
            
            if self.stringPosting == True:
                payload = self.stringPayload(payload)
            
            pay_str = json.dumps(payload)
            print(pay_str)
            topicStr = ""
            http_url = ""
            if self.localbackup:
                conn = sqlite3.connect(self.backupFile)
                cur = conn.cursor()
                cur.execute("SELECT COUNT(*) FROM bck")
                count = cur.fetchone()[0]
                if self.protocol == "mqtt":
                    if self.mqttObj.is_connected():
                        if count == 0:
                            try:
                                topicStr = "devicesIn/" + payload["device"] + "/data"
                                self.mqttObj.publish(topic=topicStr, payload=pay_str, qos=self.qos)
                                print("Posted Data to MQTT")
                                stat = 1
                            except Exception:
                                stat = 2
                                print("Error in posting to MQTT Server")
                        else:
                            stat = 2
                    else:
                        stat = 2
                elif self.protocol == "http":
                    if count == 0:
                        try:
                            http_url = f"{self.host}:{self.port}{self.path}"
                            response = http.request(method=self.method, url=http_url, data=pay_str, headers=self.headers,timeout=self.timeout)
                            stat = 1 if response.status_code == 200 else 2
                            print("Posted Data with HTTP Status Code ", response.status_code)
                        except Exception:
                            stat = 2
                            print("Error in posting to HTTP Server")
                    else:
                        stat = 2

                if stat == 2:
                    file_size = os.path.getsize(self.backupFile)
                    if file_size > 5000000:
                        cur.execute('SELECT * FROM bck LIMIT 1')
                        row = cur.fetchone()
                        cur.execute("DELETE FROM bck WHERE id=?", (row[0],))
                        conn.commit()
                        print("File Size exceeded, DELETED one record from Backup Database")
                        cur.execute("VACUUM")
                        conn.commit()
                    cur.execute("INSERT INTO bck (payload,topic) VALUES (?,?)", (pay_str, topicStr if self.protocol == "mqtt" else http_url))
                    conn.commit()
                    print("Saved to dB")
                cur.close()
                conn.close()

            else:
                if self.protocol == "mqtt":
                    try:
                        topicStr = "devicesIn/" + payload["device"] + "/data"
                        self.mqttObj.publish(topic=topicStr, payload=pay_str, qos=self.qos)
                        print("Posted Data to MQTT")
                    except Exception:
                        print("Error in posting to MQTT Server")
                elif self.protocol == "http":
                    try:
                        http_url = f"{self.host}:{self.port}{self.path}"
                        response = http.request(method=self.method, url=http_url, data=pay_str, headers=self.headers,timeout=self.timeout)
                        print("Posted Data with HTTP Status Code ", response.status_code)
                    except Exception:
                        print("Error in posting to HTTP Server")
            time.sleep(0.05)
            return stat
            
        except Exception as e:
            print(e)

    def postBackup(self, batch_count):
        try:
            conn = sqlite3.connect(self.backupFile)
            cur = conn.cursor()
            cur.execute("SELECT * FROM bck LIMIT " + str(batch_count))
            rows = cur.fetchall()
            for row in rows:
                time.sleep(0.01)
                if self.protocol == "mqtt":
                    self.mqttObj.publish(topic=row[2], payload=row[1], qos=self.qos)
                elif self.protocol == "http":
                    http.request(method=self.method, url=row[2], data=row[1], headers=self.headers,timeout=self.timeout)
                cur.execute("DELETE FROM bck WHERE id=?", (row[0],))
                conn.commit()
            cur.execute("VACUUM")
            conn.commit()
            cur.close()
            conn.close()
        except Exception as e:
            print(e)

    def background(self):
        while not self.stop_event.is_set():
            k=0
            
            while not self.data_queue.empty():
                k=k+1
                self.postOrBackup(self.data_queue.get())
                #time.sleep(0.05)
            #print(f"Cleared  {k} items from posting Queue")
            
            if self.protocol == 'mqtt':
                rc = self.mqttObj.loop(timeout=1.0)
                if self.localbackup and self.mqttObj.is_connected():
                    self.postBackup(100)
                if rc != 0:
                    try:
                        print("MQTT Disconnected")
                        self.mqttObj.connect(self.host, self.port, self.keepalive)
                    except Exception:
                        print("Error Connecting to Broker")
            else:
                time.sleep(1)

        print("Shutting Down Posting Background Thread")    

    def create_db(self):
        try:
            conn = sqlite3.connect(self.backupFile)
            cur = conn.cursor()
            cur.execute('''CREATE TABLE IF NOT EXISTS bck (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            payload TEXT NOT NULL,
                            topic TEXT NOT NULL)''')
            conn.commit()
            conn.close()            
        except Exception as err:
            print("Error in creating local db, Local Backup disabled")
            self.localbackup = False
            
    def close(self):
        self.stop_event.set()
        if self.protocol == "mqtt":
            self.mqttObj.disconnect()
        print("close")
    
    def post(self,datapacket):
        if self.blocking:
            self.postOrBackup(datapacket)
        else:
            self.data_queue.put(datapacket)
        