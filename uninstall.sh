#!/bin/bash
[[ $(id -u) -ne 0 ]] && exit 1
USERNAME=${1:-k2s}
WORKING_DIRECTORY=${2:-/usr/local/k2s}
systemctl stop k2s.service &> /dev/null
systemctl disable k2s.service &> /dev/null
rm -f /etc/systemd/system/k2s.service
systemctl daemon-reload &> /dev/null
rm -f /var/log/k2s.log &> /dev/null
su --shell /bin/bash - -c "npm remove kafkajs fast-xml-parser net-snmp dayjs dotenv js-base64" ${USERNAME}
userdel --remove ${USERNAME} &> /dev/null
groupdel ${USERNAME} &> /dev/null
[[ -d ${WORKING_DIRECTORY} ]] && rm -R -f ${WORKING_DIRECTORY} &> /dev/null
