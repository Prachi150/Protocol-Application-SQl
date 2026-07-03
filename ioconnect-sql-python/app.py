import time
import json
import threading
from pathlib import Path
import csvparser as pollConfigFunc
from sql import SQLClient
import signal
from posthandler import post_handler

def poll(config, protocol, postObj,stop_event):

    pollrates = list(map(int,list(config.keys())))
    pollrates.sort()


    #last_cycle_time = time.monotonic()*1000
    #for pollrate,rate_config in config.items():
        #rate_config["nextdue"] = last_cycle_time + (rate_config["pollrate"])

    last_cycle_time = 0
    for pollrate,rate_config in config.items():
        rate_config["nextdue"] = 0

    #print(config)
    no_new_rows_rcvd_count = 0
    while not stop_event.is_set():
        curr_time = time.monotonic()*1000

        if curr_time-last_cycle_time > 300:    #cheap rate limiter
            for pollrate in pollrates:
                rate_config = config[str(pollrate)]
                #print(pollrate/1000)
                if curr_time > rate_config["nextdue"]:
                    poll_ts = int(time.time()*1000)
                    print("########## New Poll Cycle Starting ############")
                    for table in rate_config["tables"]:

                        for packet in table["packets"]:

                            columns = packet["columns"]
                            tagConfigs = packet["tags"]
                            tableName = table["table_name"]

                            pollretry = rate_config.get("pollretry", 1)

                            success = False
                            print(f"Reading from table {tableName}")

                            for attempt in range(pollretry):
                                try:
                                    tags = protocol.read(tableName,columns,tagConfigs)
                                    success = True
                                    break
                                except Exception as e:
                                    if str(e) == "S7 read function error: S7 PLC not connected":
                                        break
                                    if stop_event.is_set():
                                        break
                                    print(f"[Retry {attempt+1}/{pollretry}] General Exception at index: {e}")
                                    time.sleep(1)

                            if not success:
                                print(f"[Index] Failed after {pollretry} retries. Skipping to next index.")
                                continue

                            #print(len(tags))


                            if len(tags) >  0:
                                for tag in tags:
                                    payload = None
                                    if tag["status"] == 1:
                                        no_new_rows_rcvd_count = 0
                                        payload = {
                                            "device": packet["devID"],
                                            "time": tag["time"],
                                            "data": tag["tags"] + [
                                                {"tag": "RSSI", "value": 22},
                                                {"tag": "Status", "value": 1}
                                            ]
                                        }
                                    elif tag["status"] == 2:
                                        no_new_rows_rcvd_count += 1
                                        if no_new_rows_rcvd_count == protocol.offline_poll_count:
                                            no_new_rows_rcvd_count = 0
                                            payload = {
                                                        "device": packet["devID"],
                                                        "time": tag["time"],
                                                        "data": [
                                                            {"tag": "RSSI", "value": 22},
                                                            {"tag": "Status", "value": 2}
                                                        ]
                                                    }
                                    else:
                                        print(tag["error"])

                                    if payload:
                                        print(payload)
                                        postObj.post(payload)

                                    print(f"Index polled and posted.")


                    print("########## Poll Cycle Finished ############\n")
                    rate_config["nextdue"] = curr_time + (rate_config["pollrate"])
                    last_cycle_time = curr_time

        time.sleep(0.001)

    #threading.Timer(config["pollrate"] / 1000, poll, (config, protocol, postObj)).start()


def main():
    dir = Path(__file__).parent
    config_path = dir / "config.csv"
    sys_path = dir / "sys_parameters.json"

    pollConfigJson = pollConfigFunc.read(config_path)
    with open(sys_path, 'r') as f:
        sys_params = json.load(f)


    stop_event = threading.Event()
    signal_handler = signal_handler_factory(stop_event)
    signal.signal(signal.SIGINT, signal_handler)   # Ctrl+C
    signal.signal(signal.SIGTERM, signal_handler)  # kill <pid>

    #data_queue = queue.Queue()

    post_type = sys_params["posting"]["type"]
    postConfig = sys_params["posting"][post_type]
    postConfig["type"] = post_type
    postObj = post_handler(postConfig, [])

    #pollIndexList = pollConfigJson['indexList']
    pollConfig = pollConfigJson['config']
    pollParams = sys_params["polling"]
    sqltype = pollParams["protocol"]

    threads = []
    for server in pollConfig:

        for database in server["databases"]:

            pollParams[sqltype]["server"] = server["server"]
            pollParams[sqltype]["port"] = int(server["port"])
            pollParams[sqltype]["database"] = database["name"]
            print(pollParams)

            protocol = SQLClient(pollParams)
            poll_config = {}
            for rate_cfg in database['pollrates']:
                rate_config = {
                    "tables" : rate_cfg["tables"],
                    #"packets": rate_cfg['packets'],
                    "pollrate": rate_cfg['rate'],
                    "pollretry": pollParams["pollRetryCount"]
                }
                poll_config[str(rate_cfg['rate'])] = rate_config
            #print(poll_config)

            t = threading.Thread(target=poll, args=(poll_config, protocol, postObj,stop_event))
            t.daemon = True
            t.start()
            threads.append(t)

    try:
        while not stop_event.is_set():
            time.sleep(1)
    except KeyboardInterrupt:
        stop_event.set()

    postObj.close()

    try:
        protocol.disconnect()
    except Exception as e:
        print(e)

    for t in threads:
        t.join()
    print("[Main] Shutdown complete.")


def signal_handler_factory(stop_event):
    def handler(sig, frame):
        print(f"[Shutdown] Caught signal: {sig}")
        stop_event.set()
    return handler


if __name__ == "__main__":
    main()