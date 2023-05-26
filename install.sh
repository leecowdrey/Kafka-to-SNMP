#!/bin/bash
[[ $(id -u) -ne 0 ]] && exit 1
USERNAME=${1:-k2s}
PASSWORD=${2:-"czNjcjN0MDA="}
WORKING_DIRECTORY=${3:-/usr/local/k2s}
SNMP_USERNAME=${4:-xxxx}
SNMP_PASSWORD=${5:-"czNjcjN0MDA="}
SNMP_BIND_TARGET=${6:-0.0.0.0}
SNMP_PORT=${7:-161}
KAFKA_BROKER=${8:-127.0.0.1:9092}
#TIME_ZONE=${9:-Europe/London}
TIME_ZONE=$(cat /etc/timezone)
#SNMP_ENGINE_ID=$(tr -dc '0-9A-F' < /dev/urandom | head -c24)
SNMP_ENGINE_ID="2D6E01FD505B876DE51E72F8"
OFFLINE_INSTALL=1

# NodeJS versions
NODE_VERSION="v18.16.0"
NODE_DISTRO="linux-x64"

# NodeJS third-party package versions
KAFKAJS_VERSION="2.2.4"
FAST_XML_PARSER_VERSION="4.2.0"
NET_SNMP_VERSION="3.9.1"
DAYJS_VERSION="1.11.7"
DOTENV_VERSION="16.0.3"
JSBASE64_VERSION="3.7.5"
#
useradd --home-dir ${WORKING_DIRECTORY} --create-home --shell /usr/sbin/nologin ${USERNAME}
echo "${USERNAME}:${PASSWORD}"|chpasswd
usermod -L ${USERNAME}

#
if [ ${OFFLINE_INSTALL} -ne 0 ] ; then
dpkg -s nodejs &> /dev/null
if [ $? -ne 0 ] ; then
   curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
   apt-get install -y nodejs && \
   npm install -g npm@latest
fi
else
   # node-v18.16.0-linux-x64.tar.xz
   echo "#!/bin/bash" > /etc/profile.d/nodejs.sh
   echo "VERSION=${NODE_VERSION}" >> /etc/profile.d/nodejs.sh
   echo "DISTRO=${NODE_DISTRO}" >> /etc/profile.d/nodejs.sh
   echo "export PATH=/usr/local/lib/nodejs/node-${NODE_VERSION}-${NODE_DISTRO}/bin:\${PATH}" >> /etc/profile.d/nodejs.sh
   chmod 644 /etc/profile.d/nodejs.sh
   mkdir -p /usr/local/lib/nodejs
   tar -xJvf node-${NODE_VERSION}-${DISTRO}.tar.xz -C /usr/local/lib/nodejs
   ln -s /usr/local/lib/nodejs/node-${NODE_VERSION}-${NODE_DISTRO}/bin/node /usr/bin/node
   ln -s /usr/local/lib/nodejs/node-${NODE_VERSION}-${NODE_DISTRO}/bin/npm /usr/bin/npm
   ln -s /usr/local/lib/nodejs/node-${NODE_VERSION}-${NODE_DISTRO}/bin/npx /usr/bin/npx
fi

#
[[ ! -d ${WORKING_DIRECTORY} ]] && (mkdir -p ${WORKING_DIRECTORY} ; chown ${USERNAME} ${WORKING_DIRECTORY})

#
cp k2s.js ${WORKING_DIRECTORY}/ && chown ${USERNAME} ${WORKING_DIRECTORY}/k2s.js
cp topics.kafka ${WORKING_DIRECTORY}/ && chown ${USERNAME} ${WORKING_DIRECTORY}/topics.kafka
cp .env ${WORKING_DIRECTORY}/
sed -i -e "s/SNMP_USERNAME=.*/SNMP_USERNAME=\"${SNMP_USERNAME}\"/" ${WORKING_DIRECTORY}/.env
sed -i -e "s/SNMP_PASSWORD=.*/SNMP_PASSWORD=\"${SNMP_PASSWORD}\"/" ${WORKING_DIRECTORY}/.env
sed -i -e "s/SNMP_BIND_TARGET=.*/SNMP_BIND_TARGET=\"${SNMP_BIND_TARGET}\"/" ${WORKING_DIRECTORY}/.env
sed -i -e "s/SNMP_PORT=.*/SNMP_PORT=${SNMP_PORT}/" ${WORKING_DIRECTORY}/.env
sed -i -e "s/SNMP_ENGINE_ID=.*/SNMP_ENGINE_ID=\"8000B98380${SNMP_ENGINE_ID}\"/" ${WORKING_DIRECTORY}/.env
sed -i -e "s/KAFKA_BROKER=.*/KAFKA_BROKER=\"${KAFKA_BROKER}\"/" ${WORKING_DIRECTORY}/.env
sed -i -e "s/TIME_ZONE=.*/TIME_ZONE=\"${TIME_ZONE}\"/" ${WORKING_DIRECTORY}/.env
chown ${USERNAME} ${WORKING_DIRECTORY}/.env

#
if [ ${OFFLINE_INSTALL} -ne 0 ] ; then
  # npm install kafkajs@2.2.4 fast-xml-parser@4.2.0 net-snmp@3.9.1 dayjs@1.11.7 dotenv@16.0.3 js-base64@3.7.5
  su --shell /bin/bash - -c "npm install kafkajs@${KAFKAJS_VERSION} fast-xml-parser@${FAST_XML_PARSER_VERSION} net-snmp@${NET_SNMP_VERSION} dayjs@${DAYJS_VERSION} dotenv@${DOTENV_VERSION} js-base64@${JSBASE64_VERSION}" ${USERNAME}
else
 cp -f kafkajs-${KAFKAJS_VERSION}.tgz ${WORKING_DIRECTORY}/ && chown ${USERNAME} ${WORKING_DIRECTORY}/kafkajs-${KAFKAJS_VERSION}.tgz
 cp -f fast-xml-parser-${FAST_XML_PARSER_VERSION}.tgz ${WORKING_DIRECTORY}/ && chown ${USERNAME} ${WORKING_DIRECTORY}/ fast-xml-parser-${FAST_XML_PARSER_VERSION}.tgz
 cp -f net-snmp-${NET_SNMP_VERSION}.tgz ${WORKING_DIRECTORY}/ && chown ${USERNAME} ${WORKING_DIRECTORY}/net-snmp-${NET_SNMP_VERSION}.tgz
 cp -f dayjs-${DAYJS_VERSION}.tgz ${WORKING_DIRECTORY}/ && chown ${USERNAME} ${WORKING_DIRECTORY}/dayjs-${DAYJS_VERSION}.tgz
 cp -f dotenv-${DOTENV_VERSION}.tgz ${WORKING_DIRECTORY}/ && chown ${USERNAME} ${WORKING_DIRECTORY}/dotenv-${DOTENV_VERSION}.tgz
 cp -f js-base64-${JSBASE64_VERSION}.tgz ${WORKING_DIRECTORY}/ && chown ${USERNAME} ${WORKING_DIRECTORY}/js-base64-${JSBASE64_VERSION}.tgz
 su --shell /bin/bash - -c "npm install kafkajs-${KAFKAJS_VERSION}.tgz fast-xml-parser-${FAST_XML_PARSER_VERSION}.tgz net-snmp-${NET_SNMP_VERSION}.tgz dayjs-${DAYJS_VERSION}.tgz dotenv-${DOTENV_VERSION}.tgz js-base64-${JSBASE64_VERSION}" ${USERNAME}
fi

#
touch /var/log/k2s.log && chown ${USERNAME} /var/log/k2s.log && chmod 664 /var/log/k2s.log

# handled via systemD service
#setcap CAP_NET_BIND_SERVICE=+ep $(which node)

#
cp -f k2s.service /etc/systemd/system/k2s.service
sed -i -e "s/User=.*/User=${USERNAME}/" /etc/systemd/system/k2s.service
sed -i -e "s/Group=.*/Group=${USERNAME}/" /etc/systemd/system/k2s.service
sed -i -e "s|WorkingDirectory=.*|WorkingDirectory=${WORKING_DIRECTORY}|" /etc/systemd/system/k2s.service

systemctl daemon-reload && \
systemctl enable k2s.service && \
systemctl start k2s.service && \
systemctl status k2s.service

exit
