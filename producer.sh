#!/bin/bash
KAFKA_BROKER="192.168.111.8:9092"
DEVICE_UUID="4f3a10c0-ba14-4bd1-a879-7b1f25cf8656"

metricEvents() {
    # xxxx-pon-gemport-metrics
    EVENT_TIME=$(date +"%Y-%m-%dT%H:%M:%SZ")
    echo "{\"actual-gemport-id\":1032, \"if-type\":\"olt\", \"name\":\"onu1-1-gem-0\", \"olt\":\"${DEVICE_UUID}\", \"onu\":\"onu1\", \"sub-if-type\":\"gem\", \"time-stamp\":\"${EVENT_TIME}\", \"v-ani-side.in-frames\":${IN_PKTS}, \"v-ani-side.out-frames\":${OUT_PKTS}}"|$KAFKA_HOME/bin/kafka-console-producer.sh --topic xxxx-pon-gemport-metrics --broker-list ${KAFKA_BROKER}
    echo "{\"actual-gemport-id\":1033, \"if-type\":\"olt\", \"name\":\"onu2-1-gem-0\", \"olt\":\"${DEVICE_UUID}\", \"onu\":\"onu2\", \"sub-if-type\":\"gem\", \"time-stamp\":\"${EVENT_TIME}\", \"v-ani-side.in-frames\":${IN_PKTS}, \"v-ani-side.out-frames\":${OUT_PKTS}}"|$KAFKA_HOME/bin/kafka-console-producer.sh --topic xxxx-pon-gemport-metrics --broker-list ${KAFKA_BROKER}
    # xxxx-pon-interfacet-metrics
    EVENT_TIME=$(date +"%Y-%m-%dT%H:%M:%SZ")
    echo "{\"if-type\":\"olt\", \"in-discards\":0, \"in-errors\":0, \"in-pkts\":${IN_PKTS}, \"in-unicast-pkts\":${IN_UNICAST_PKTS}, \"name\":\"cpair-1-1-1\", \"olt\":\"${DEVICE_UUID}\", \"onu\":\"na\", \"out-discards\":0, \"out-pkts\":${OUT_PKTS}, \"out-unicast-pkts\":${OUT_UNICAST_PKTS}, \"sub-if-type\":\"channel-pair\", \"time-stamp\":\"${EVENT_TIME}\", \"type\":\"bbf-xponift:channel-pair\", \"xpon.gemport.hec-errors\":${HEC_ERRORS}, \"xpon.gemport.in-frames\":${IN_FRAMES}, \"xpon.gemport.key-errors\":0, \"xpon.gemport.out-frames\":${OUT_FRAMES}, \"xpon.phy.in-bip-errors\":0, \"xpon.phy.in-bip-protected-words\":0, \"xpon.phy.in-fec-codewords\":0, \"xpon.phy.uncorrectable-fec-codewords\":0, \"xpon.ploam.downstream-messages.total\":0, \"xpon.ploam.upstream-messages.total\":0}"|$KAFKA_HOME/bin/kafka-console-producer.sh --topic xxxx-pon-interface-metrics --broker-list ${KAFKA_BROKER}
    EVENT_TIME=$(date +"%Y-%m-%dT%H:%M:%SZ")
    echo "{\"if-type\":\"olt\", \"in-discards\":0, \"in-errors\":0, \"in-pkts\":${IN_PKTS}, \"in-unicast-pkts\":${IN_UNICAST_PKTS}, \"name\":\"cpair-1-1-2\", \"olt\":\"${DEVICE_UUID}\", \"onu\":\"na\", \"out-discards\":0, \"out-pkts\":${OUT_PKTS}, \"out-unicast-pkts\":${OUT_UNICAST_PKTS}, \"sub-if-type\":\"channel-pair\", \"time-stamp\":\"${EVENT_TIME}\", \"type\":\"bbf-xponift:channel-pair\", \"xpon.gemport.hec-errors\":${HEC_ERRORS}, \"xpon.gemport.in-frames\":${IN_FRAMES}, \"xpon.gemport.key-errors\":0, \"xpon.gemport.out-frames\":${OUT_FRAMES}, \"xpon.phy.in-bip-errors\":0, \"xpon.phy.in-bip-protected-words\":0, \"xpon.phy.in-fec-codewords\":0, \"xpon.phy.uncorrectable-fec-codewords\":0, \"xpon.ploam.downstream-messages.total\":0, \"xpon.ploam.upstream-messages.total\":0}"|$KAFKA_HOME/bin/kafka-console-producer.sh --topic xxxx-pon-interface-metrics --broker-list ${KAFKA_BROKER}
}

stopTest() {
   exit 1
}

HEC_ERRORS=0
OUT_PKTS=0
IN_PKTS=0
IN_UNICAST_PKTS=0
OUT_UNICAST_PKTS=0
OUT_FRAMES=0
IN_FRAMES=0

$KAFKA_HOME/bin/kafka-topics.sh --create --topic xxxx-pon-gemport-metrics --bootstrap-server ${KAFKA_BROKER}
$KAFKA_HOME/bin/kafka-topics.sh --create --topic xxxx-pon-interface-metrics --bootstrap-server ${KAFKA_BROKER}

trap stopTest SIGINT
until [ 0 -ne 0 ]; do
 echo -n "."
 sleep 15
# mountEvents
 sleep 5
# alarmEvents
 sleep 5
 ((HEC_ERRORS=HEC_ERRORS + 1))
 ((OUT_PKTS=OUT_PKTS + 1))
 ((IN_PKTS=IN_PKTS + 3))
 ((IN_UNICAST_PKTS=IN_UNICAST_PKTS + 1))
 ((OUT_UNICAST_PKTS=OUT_UNICAST_PKTS + 2))
 ((OUT_FRAMES=OUT_FRAMES + 1))
 ((IN_FRAMES=IN_FRAMES + 1))
 metricEvents
done
trap - SIGINT
