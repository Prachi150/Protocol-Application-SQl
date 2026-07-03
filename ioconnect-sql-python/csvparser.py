import csv
import json
import re
from typing import Tuple


def read(csvFilePath):
    csvJson = []

    with open(csvFilePath, 'r') as file:
        reader = csv.DictReader(file)
        csvJson = list(reader)

    finalJson = convert(csvJson)
    return finalJson

def convert(inputJson):

    package2 = []
    finalJson = {}
    tags = []

    tags = [
                {
                    "tagName": inputJson[0]["tag"],
                    "datatype": inputJson[0]["datatype"],
                    "resolution": int(inputJson[0]["resolution"])
                }
            ]

    package2.append({
        "server": inputJson[0]["server"],
        "port": inputJson[0]["port"],
        "databases" : [{
            "name" : inputJson[0]["database"],
            "pollrates": [{
                "rate": int(inputJson[0]["lograte"]),
                "tables" : [{
                    "table_name" : inputJson[0]["table"],
                    "packets": [{
                        "devID": inputJson[0]["device"],
                        "columns": [inputJson[0]["column"]],
                        "tags": tags
                    }]
                }]
            }]
        }]
    })
    prevColumn = inputJson[0]["column"]

    #print(inputJson)
    serverIndex =0
    packetIndex = 0
    rateIndex = 0
    databaseIndex = 0
    tableIndex = 0

    for i in range(1, len(inputJson)):

        currIndexLen =0

        if inputJson[i]["server"] != package2[serverIndex]["server"]:
            k += 1
            serverIndex += 1
            packetIndex = 0
            rateIndex = 0
            databaseIndex = 0
            tableIndex = 0

            addresses = {}
            tags = [
                        {
                            "tagName": inputJson[i]["tag"],
                            "datatype": inputJson[i]["datatype"],
                            "resolution": int(inputJson[i]["resolution"])
                        }
                    ]

            package2.append({
                "server": inputJson[i]["server"],
                "port": inputJson[i]["port"],
                "databases" : [{
                    "name" : inputJson[i]["database"],
                    "pollrates": [{
                        "rate": int(inputJson[i]["lograte"]),
                        "tables" : [{
                            "table_name" : inputJson[i]["table"],
                            "packets": [{
                                "devID": inputJson[i]["device"],
                                "columns": [inputJson[i]["column"]],
                                "tags": tags
                            }]
                        }]
                    }]
                }]
            })
        elif inputJson[i]["database"] != package2[serverIndex]["databases"][databaseIndex]["name"]:
            packetIndex = 0
            rateIndex = 0
            tableIndex = 0
            databaseIndex = databaseIndex+1

            tags = [
                        {
                            "tagName": inputJson[i]["tag"],
                            "datatype": inputJson[i]["datatype"],
                            "resolution": int(inputJson[i]["resolution"])
                        }
                    ]

            package2[serverIndex]["databases"].append({
                "name" : inputJson[i]["database"],
                "pollrates": [{
                    "rate": int(inputJson[i]["lograte"]),
                    "tables" : [{
                        "table_name" : inputJson[i]["table"],
                        "packets": [{
                            "devID": inputJson[i]["device"],
                            "columns": [inputJson[i]["column"]],
                            "tags": tags
                        }]
                    }]
                }]
            })


        elif int(inputJson[i]["lograte"]) != package2[serverIndex]["databases"][databaseIndex]["pollrates"][rateIndex]["rate"]:
            packetIndex = 0
            tableIndex = 0
            rateIndex += 1

            tags = [
                        {
                            "tagName": inputJson[i]["tag"],
                            "datatype": inputJson[i]["datatype"],
                            "resolution": int(inputJson[i]["resolution"])
                        }
                    ]

            package2[serverIndex]["databases"][databaseIndex]["pollrates"].append({
                "rate": int(inputJson[i]["lograte"]),
                "tables" : [{
                    "table_name" : inputJson[i]["table"],
                    "packets": [{
                        "devID": inputJson[i]["device"],
                        "columns": [inputJson[i]["column"]],
                        "tags": tags
                    }]
                }]
            })

        elif inputJson[i]["table"] != package2[serverIndex]["databases"][databaseIndex]["pollrates"][rateIndex]["tables"][tableIndex]["table_name"]:
            packetIndex = 0
            tableIndex +=1

            tags = [
                        {
                            "tagName": inputJson[i]["tag"],
                            "datatype": inputJson[i]["datatype"],
                            "resolution": int(inputJson[i]["resolution"])
                        }
                    ]

            package2[serverIndex]["databases"][databaseIndex]["pollrates"][rateIndex]["tables"].append({
                "table_name" : inputJson[i]["table"],
                "packets": [{
                    "devID": inputJson[i]["device"],
                    "columns": [inputJson[i]["column"]],
                    "tags": tags
                }]
            })

        elif inputJson[i]["device"] != package2[serverIndex]["databases"][databaseIndex]["pollrates"][rateIndex]["tables"][tableIndex]["packets"][packetIndex]["devID"]:
            packetIndex += 1
            tags = [
                        {
                            "tagName": inputJson[i]["tag"],
                            "datatype": inputJson[i]["datatype"],
                            "resolution": int(inputJson[i]["resolution"])
                        }
                    ]
            package2[serverIndex]["databases"][databaseIndex]["pollrates"][rateIndex]["tables"][tableIndex]["packets"].append({
                    "devID": inputJson[i]["device"],
                    "columns": [inputJson[i]["column"]],
                    "tags": tags
                })

        elif inputJson[i]["column"] != prevColumn:
            tag = {
                    "tagName": inputJson[i]["tag"],
                    "datatype": inputJson[i]["datatype"],
                    "resolution": int(inputJson[i]["resolution"])
                }

            package2[serverIndex]["databases"][databaseIndex]["pollrates"][rateIndex]["tables"][tableIndex]["packets"][packetIndex]["columns"].append(inputJson[i]["column"])
            package2[serverIndex]["databases"][databaseIndex]["pollrates"][rateIndex]["tables"][tableIndex]["packets"][packetIndex]["tags"].append(tag)

        else:
            raise Exception(f"replicated")


        prevColumn = inputJson[i]["column"]



    finalJson = {"config": package2}

    with open("SQL_config.json", "w") as file:
        json.dump(finalJson, file, indent='\t')

    return finalJson

# Usage
# finalJson = read('config_test.csv')
read("config.csv")