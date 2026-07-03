#!/bin/bash
# Prints Unix epoch (seconds) when the lsg-app service last became active. Exit 1 on failure.
TS=$(systemctl show lsg-app --property=ActiveEnterTimestamp --value 2>/dev/null)
[ -z "$TS" ] || [ "$TS" = "n/a" ] && exit 1
date -d "$TS" +%s 2>/dev/null || exit 1
