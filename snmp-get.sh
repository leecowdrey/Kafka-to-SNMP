#!/bin/bash
GEMPORT_TABLE_OID="1.3.6.1.4.1.4115.1.10.1.1"
for D in {1..2}; do
    echo "GEMPORT Device: ${D}"
    # .1 is Idx
    for I in {2..10}; do
        snmpget -v 1 -c public 127.0.0.1:161 ${GEMPORT_TABLE_OID}.${I}.${D}
    done
done
echo "INTERFACE Device: 1"
INTERFACE_TABLE_OID="1.3.6.1.4.1.4115.1.10.1.2"
    # .1 is Idx
for I in {2..25}; do
    snmpget -v 1 -c public 127.0.0.1:161 ${INTERFACE_TABLE_OID}.${I}.1
done
