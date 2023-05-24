const { Kafka, logLevel } = require("kafkajs");
const fs = require("fs");
const { XMLParser, XMLBuilder, XMLValidator } = require("fast-xml-parser");
const snmp = require("net-snmp");
const { Base64 } = require("js-base64");
require("dotenv").config();
const dayjs = require("dayjs");
const dayjsUtc = require("dayjs/plugin/utc");
const dayjsTimezone = require("dayjs/plugin/timezone"); // dependent on utc plugin
dayjs.extend(dayjsUtc);
dayjs.extend(dayjsTimezone);
dayjs.tz.setDefault(process.env.TIME_ZONE || "UTC");

var TOPICS = new Array();
var MIB_TOPICS = new Array();
var CONSUME_TOPICS = new Array();
var snmpAgent;
var mib;
var ponInterfaceMetricsTable;
var gemportMetricsTable;
var kafka;

// Decoded passwords, keys etc.
const KAFKA_DECODED_PASSWORD = Base64.decode(process.env.KAFKA_PASSWORD);
const SNMP_DECODED_AUTH_KEY = Base64.decode(process.env.SNMP_AUTH_KEY);
const SNMP_DECODED_PRIV_KEY = Base64.decode(process.env.SNMP_PRIV_KEY);
if (parseBoolean(process.env.DEBUG)) {
  console.log("Base64 Decoded Passwords", {
    kafka: KAFKA_DECODED_PASSWORD,
    snmpAuthPriv: SNMP_DECODED_AUTH_KEY,
    snmpPrivKey: SNMP_DECODED_PRIV_KEY,
  });
}

function parseBoolean(s) {
  return s.toLowerCase() === "true";
}

function validContent(format, data) {
  let valid = false;
  try {
    switch (format.toLowerCase()) {
      case process.env.FORMAT_XML.toLowerCase():
        valid = XMLValidator.validate(data);
        if (!valid) {
          valid = false;
        }
        break;
      case process.env.FORMAT_JSON.toLowerCase():
        try {
          const j = JSON.parse(data);
          valid = true;
        } catch (e) {
          valid = false;
        }
        break;
      default:
        break;
    }
  } catch (e) {
    valid = false;
  }
  return valid;
}

// read list of Kafka topics to consume, extract structure
function readListOfTopics() {
  try {
    function sliceStruct(struct) {
      let tlSplit = struct.split(process.env.TOPICS_FILE_SEPERATOR);
      let tlObj = { name: tlSplit[0].toString(), oid: tlSplit[1].toString() };
      TOPICS.push(tlObj);
    }
    var tl = fs.readFileSync(process.env.KAFKA_TOPICS, "utf8").split("\n");
    let t = tl.length;
    const commentRegex = /\s{0,}#.*$/;
    while (t--) {
      if (tl[t].startsWith(process.env.TOPICS_FILE_COMMENT)) {
        tl.splice(t, 1);
      } else if (tl[t] == null || tl[t].length == 0) {
        tl.splice(t, 1);
      } else if (tl[t].indexOf(process.env.TOPICS_FILE_COMMENT) > -1) {
        tl[t] = tl[t].replace(commentRegex, "");
        let splitVerify =
          tl[t].split(process.env.TOPICS_FILE_SEPERATOR).length - 1;
        if (splitVerify == process.env.TOPICS_FILE_SEPERATOR_EXPECTED) {
          sliceStruct(tl[t]);
        } else {
          console.error("Removing invalid topic definition", tl[t]);
          tl.splice(t, 1);
        }
      } else {
        let splitVerify =
          tl[t].split(process.env.TOPICS_FILE_SEPERATOR).length - 1;
        if (splitVerify == process.env.TOPICS_FILE_SEPERATOR_EXPECTED) {
          sliceStruct(tl[t]);
        } else {
          console.error("Removing invalid topic definition", tl[t]);
          tl.splice(t, 1);
        }
      }
    }
  } catch (e) {
    if (e.code === "ENOENT") {
      console.error(process.env.KAFKA_TOPICS, "file not found");
    } else {
      console.error(process.env.KAFKA_TOPICS, e.message);
    }
    try {
      if (consumer != null) {
        consumer.disconnect();
      }
      if (snmpAgent != null) {
        snmpAgent.close();
      }
    } finally {
      process.exit(1);
    }
  }
}

async function findRowsInMib(providerTable) {
  let rows = 0;
  try {
    let c1 = mib.getTableColumnCells(providerTable, 2);
    rows = c1.length;
  } catch (e) {
    rows = 0;
  }
  if (parseBoolean(process.env.DEBUG))
    console.log("findRowsInMib", providerTable, rows);
  return Promise.resolve(rows);
}

function deleteStaleRowsInMib(providerTable, timestampColumn, timestampFormat) {
  let rows = 0;
  let stalePeriod = parseInt(process.env.SNMP_STALE_PERIOD || "1", "10");
  try {
    let cX = mib.getTableColumnCells(providerTable, 2);
    let nX = dayjs();
    if (parseBoolean(process.env.DEBUG))
      console.log("deleteStaleRowsInMib now", nX.toString());
    for (let r = cX.length; r > 0; r--) {
      if (parseBoolean(process.env.DEBUG))
        console.log("deleteStaleRowsInMib checking", providerTable, r);
      let rX = mib.getTableSingleCell(providerTable, timestampColumn, [r]);
      let tX = dayjs(rX, timestampFormat);
      let dX = tX.diff(nX, process.env.SNMP_STALE_UNIT, "day");
      if (dX > stalePeriod) {
        if (parseBoolean(process.env.DEBUG))
          console.log("deleteStaleRowsInMib delete", providerTable, r);
        mib.deleteTableRow(providerTable, [r]);
      }
    }
  } catch (e) {}
}

function checkStaleRows() {
  if (parseInt(process.env.SNMP_STALE_PERIOD || "1", "10") > 0) {
    //MIB.TOPICS.name
    let topics = CONSUME_TOPICS.length;
    for (let t = 0; t < topics; t++) {
      let topic = CONSUME_TOPICS[t];
      switch (topic) {
        case "xxxx-pon-interface-metrics":
          if (parseBoolean(process.env.DEBUG))
            console.log("checkStaleRows running", topic);
          deleteStaleRowsInMib(
            "ponInterfaceMetricsTable",
            8,
            "YYYY-MM-DDTHH:mm:ssZ"
          );
          break;
        case "xxxx-pon-gemport-metrics":
          if (parseBoolean(process.env.DEBUG))
            console.log("checkStaleRows running", topic);
          deleteStaleRowsInMib(
            "gemportMetricsTable",
            8,
            "YYYY-MM-DDTHH:mm:ssZ"
          );
          break;
        default:
          break;
      }
    }
  } else {
    if (parseBoolean(process.env.DEBUG)) console.log("checkStaleRows skipping");
  }
}

async function AddRowToMib(providerTable, cells) {
  try {
    mib.addTableRow(providerTable, cells);
  } catch (e) {
    console.error("AddRowToMib", e);
  }
  return Promise.resolve();
}

async function UpdateRowCellToMib(providerTable, column, row, value) {
  try {
    mib.setTableSingleCell(providerTable, column, [row], value);
  } catch (e) {
    console.error("UpdateRowCellToMib", e);
  }
  return Promise.resolve();
}

async function findABRowInMib(providerTable, A, B) {
  let row = 0;
  let rows = 0;
  rows = await findRowsInMib(providerTable);
  if (rows > 0) {
    for (let r = 1; r < rows; r++) {
      if (parseBoolean(process.env.DEBUG))
        console.log("findABRowInMib checking", providerTable, r, rows);
      let c2 = mib.getTableSingleCell(providerTable, 2, [r]);
      let c3 = mib.getTableSingleCell(providerTable, 3, [r]);
      if (A === c2 && B === c3) {
        if (parseBoolean(process.env.DEBUG))
          console.log("findABRowInMib found", providerTable, r, rows, c2, c3);
        row = r;
        break;
      }
    }
  } else {
    if (parseBoolean(process.env.DEBUG))
      console.log("findABRowInMib no rows", providerTable);
    return 0;
  }
  return Promise.resolve(row);
}

async function findABCRowInMib(providerTable, A, B, C) {
  let row = 0;
  let rows = 0;
  rows = await findRowsInMib(providerTable);
  if (rows > 0) {
    for (let r = 1; r < rows; r++) {
      if (parseBoolean(process.env.DEBUG))
        console.log("findABCRowInMib checking", providerTable, r, rows);
      let c2 = mib.getTableSingleCell(providerTable, 2, [r]);
      let c3 = mib.getTableSingleCell(providerTable, 3, [r]);
      let c4 = mib.getTableSingleCell(providerTable, 4, [r]);
      if (parseBoolean(process.env.DEBUG))
        console.log("findABCRowInMib", {
          A: A,
          c2: c2,
          B: B,
          c3: c3,
          C: C,
          c4: c4,
        });
      if (A === c2 && B === c3 && C === c4) {
        if (parseBoolean(process.env.DEBUG))
          console.log(
            "findABCRowInMib found",
            providerTable,
            r,
            rows,
            c2,
            c3,
            c4
          );
        row = r;
        break;
      }
    }
  } else {
    if (parseBoolean(process.env.DEBUG))
      console.log("findABCRowInMib no rows", providerTable);
    return 0;
  }
  return Promise.resolve(row);
}

async function findNextIdxInMib(providerTable) {
  let row = await findRowsInMib(providerTable);
  return Promise.resolve(++row);
}

function existsTopic(name) {
  let t = TOPICS.length;
  let exists = false;
  while (t--) {
    if (TOPICS[t].name === name) {
      exists = true;
      break;
    }
  }
  if (parseBoolean(process.env.DEBUG)) console.log("existsTopic", name, exists);
  return exists;
}

function findTopicOid(name) {
  let t = TOPICS.length;
  let oid = "";
  while (t--) {
    if (TOPICS[t].name === name) {
      oid = TOPICS[t].oid;
      break;
    }
  }
  if (parseBoolean(process.env.DEBUG)) console.log("findTopicOid", name, oid);
  return oid;
}

if (parseBoolean(process.env.DEBUG)) console.log(process.env);

readListOfTopics();
if (TOPICS.length == 0) {
  if (parseBoolean(process.env.DEBUG)) console.error("no topics defined");
  process.exit(1);
}

var snmpUser = {
  name: process.env.SNMP_USERNAME,
  level: parseInt(process.env.SNMP_AUTH_LEVEL),
  authProtocol: parseInt(process.env.SNMP_AUTH_PROTOCOL),
  authKey: SNMP_DECODED_AUTH_KEY,
  privProtocol: parseInt(process.env.SNMP_AUTH_PROTOCOL),
  privKey: SNMP_DECODED_PRIV_KEY,
};

var snmpOptions = {
  port: parseInt(process.env.SNMP_PORT),
  address: process.env.SNMP_BIND_TARGET,
  disableAuthorization: false,
  includeAuthentication: true,
  transport: process.env.SNMP_TRANSPORT,
  engineID: process.env.SNMP_ENGINE_ID,
  accessControlModeType: snmp.AccessControlModelType.Simple,
};
var snmpCallback = function (error, notification) {
  if (error) {
    console.error(error);
  } else {
    console.log(JSON.stringify(notification, null, 2));
  }
};
// SNMP server
if (parseBoolean(process.env.DEBUG))
  console.log("SNMP server bind", snmpOptions);
snmpAgent = snmp.createAgent(snmpOptions, snmpCallback);

// SNMP access control, simulatenous v1, v2c and v3
var snmpAuthorizer = snmpAgent.getAuthorizer();
snmpAuthorizer.addCommunity(
  process.env.SNMP_COMMUNITY_RO,
  snmp.AccessLevel.ReadOnly
);
snmpAuthorizer.addCommunity(
  process.env.SNMP_COMMUNITY_RW,
  snmp.AccessLevel.ReadOnly
);
snmpAuthorizer.addUser(snmpUser, snmp.AccessLevel.ReadOnly);

// MIB tables
if (existsTopic("xxxx-pon-gemport-metrics")) {
  gemportMetricsTable = {
    name: "gemportMetricsTable",
    type: snmp.MibProviderType.Table,
    oid: findTopicOid("xxxx-pon-gemport-metrics"),
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      {
        number: 1,
        name: "gpIdx",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess["not-accessible"],
      },
      {
        number: 2,
        name: "gpOltId",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: process.env.DEVICE_ID_NULL,
      },
      {
        number: 3,
        name: "gpOnuId",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: process.env.DEVICE_ID_NULL,
      },
      {
        number: 4,
        name: "gpActualGemportId",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 5,
        name: "gpNameGameport",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
      },
      {
        number: 6,
        name: "gpIfType",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
      },
      {
        number: 7,
        name: "gpSubIfType",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
      },
      {
        number: 8,
        name: "gpTimeStamp",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
      },
      {
        number: 9,
        name: "gpVAniSideInFrames",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 10,
        name: "gpVAniSideOutFrames",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
    ],
    tableIndex: [
      {
        columnName: "gpIdx",
      },
    ],
    handler: function gemportMetrics(mibRequest) {
      // e.g. can update the table before responding to the request here
      mibRequest.done();
    },
  };
  CONSUME_TOPICS.push("xxxx-pon-gemport-metrics");
  MIB_TOPICS.push(gemportMetricsTable);
}

if (existsTopic("xxxx-pon-interface-metrics")) {
  ponInterfaceMetricsTable = {
    name: "ponInterfaceMetricsTable",
    type: snmp.MibProviderType.Table,
    oid: findTopicOid("xxxx-pon-interface-metrics"),
    maxAccess: snmp.MaxAccess["not-accessible"],
    tableColumns: [
      {
        number: 1,
        name: "piIdx",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess["not-accessible"],
      },
      {
        number: 2,
        name: "piOltId",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: process.env.DEVICE_ID_NULL,
      },
      {
        number: 3,
        name: "piOnuId",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: process.env.DEVICE_ID_NULL,
      },
      {
        number: 4,
        name: "piName",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: "cpair---",
      },
      {
        number: 5,
        name: "piIfType",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: "olt",
      },
      {
        number: 6,
        name: "piSubIfType",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: "",
      },
      {
        number: 7,
        name: "piType",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: "",
      },
      {
        number: 8,
        name: "piTimeStamp",
        type: snmp.ObjectType.OctetString,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: "",
      },
      {
        number: 9,
        name: "piInDiscards",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 10,
        name: "piInErrors",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 11,
        name: "piInPkts",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 12,
        name: "piInUnicastPkts",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 13,
        name: "piOutDiscards",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 14,
        name: "piOutPkts",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 15,
        name: "piOutUnicastPkts",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 16,
        name: "piGemportHecErrors",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 17,
        name: "piGemportInFrames",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 18,
        name: "piGemportOutFrames",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 19,
        name: "piGemportKeyErrors",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 20,
        name: "piPhyInBipErrors",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 21,
        name: "piPhyInBipProtWords",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 22,
        name: "piPhyInFecCodeWords",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 23,
        name: "piPhyUncorrFecCodeWords",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 24,
        name: "piPhyPloamDownstreamMessages",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
      {
        number: 25,
        name: "piPhyPloamUpstreamMessages",
        type: snmp.ObjectType.Integer,
        maxAccess: snmp.MaxAccess[process.env.SNMP_MAX_ACCESS],
        defVal: 0,
      },
    ],
    tableIndex: [
      {
        columnName: "piIdx",
      },
    ],
    handler: function ponInterfaceMetricsTable(mibRequest) {
      // e.g. can update the table before responding to the request here
      mibRequest.done();
    },
  };
  CONSUME_TOPICS.push("xxxx-pon-interface-metrics");
  MIB_TOPICS.push(ponInterfaceMetricsTable);
}

mib = snmpAgent.getMib();
mib.registerProviders(MIB_TOPICS);
if (parseBoolean(process.env.DEBUG))
  console.log("mibProviders", mib.getProviders());

// Kafka consumer client connection
if (parseBoolean(process.env.KAFKA_SSL)) {
  if (!fs.existsSync(process.env.KAFKA_SSL_CA)) {
    console.error("KAFKA_SSL_CA file not found", process.env.KAFKA_SSL_CA);
    try {
      if (consumer != null) {
        consumer.disconnect();
      }
      if (snmpAgent != null) {
        snmpAgent.close();
      }
    } catch (_) {}
    process.exit(1);
  }
  if (!fs.existsSync(process.env.KAFKA_SSL_KEY)) {
    console.error("KAFKA_SSL_KEY file not found", process.env.KAFKA_SSL_KEY);
    try {
      if (consumer != null) {
        consumer.disconnect();
      }
      if (snmpAgent != null) {
        snmpAgent.close();
      }
    } catch (_) {}
    process.exit(1);
  }
  if (!fs.existsSync(process.env.KAFKA_SSL_CERT)) {
    console.error("KAFKA_SSL_CERT file not found", process.env.KAFKA_SSL_CERT);
    try {
      if (consumer != null) {
        consumer.disconnect();
      }
      if (snmpAgent != null) {
        snmpAgent.close();
      }
    } catch (_) {}
    process.exit(1);
  }
  //
  kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID,
    brokers: [process.env.KAFKA_BROKER],
    logLevel: parseInt(process.env.KAFKA_LOGLEVEL),
    sasl: false,
    ssl: {
      rejectUnauthorized: false,
      ca: [fs.readFileSync(process.env.KAFKA_SSL_CA, "utf-8")],
      key: fs.readFileSync(process.env.KAFKA_SSL_KEY, "utf-8"),
      cert: fs.readFileSync(process.env.KAFKA_SSL_CERT, "utf-8"),
    },
    requestTimeout: parseInt(process.env.KAFKA_REQUEST_TIMEOUT),
    sessionTimeout: parseInt(process.env.KAFKA_SESSION_TIMEOUT),
    enforceRequestTimeout: parseInt(process.env.KAFKA_ENFORCE_REQUEST_TIMEOUT),
    minBytes: parseInt(process.env.KAFKA_MIN_BYTES),
    maxBytes: parseInt(process.env.KAFKA_MAX_BYTES),
    maxWaitTimeInMs: parseInt(process.env.KAFKA_MAX_WAIT_TIMEOUT),
    retry: {
      initialRetryTime: parseInt(process.env.KAFKA_INITIAL_RETRY_TIME),
      retries: parseInt(process.env.KAFKA_RETRIES),
    },
  });
} else if (parseBoolean(process.env.KAFKA_SASL)) {
  kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID,
    brokers: [process.env.KAFKA_BROKER],
    logLevel: parseInt(process.env.KAFKA_LOGLEVEL),
    ssl: true,
    sasl: {
      mechanism: process.env.KAFKA_SASL_MECHANISM.toLowerCase(), // plain, scram-sha-256 or scram-sha-512
      username: process.env.KAFKA_USERNAME,
      password: KAFKA_DECODED_PASSWORD,
    },
    requestTimeout: parseInt(process.env.KAFKA_REQUEST_TIMEOUT),
    sessionTimeout: parseInt(process.env.KAFKA_SESSION_TIMEOUT),
    enforceRequestTimeout: parseInt(process.env.KAFKA_ENFORCE_REQUEST_TIMEOUT),
    minBytes: parseInt(process.env.KAFKA_MIN_BYTES),
    maxBytes: parseInt(process.env.KAFKA_MAX_BYTES),
    maxWaitTimeInMs: parseInt(process.env.KAFKA_MAX_WAIT_TIMEOUT),
    retry: {
      initialRetryTime: parseInt(process.env.KAFKA_INITIAL_RETRY_TIME),
      retries: parseInt(process.env.KAFKA_RETRIES),
    },
  });
} else {
  kafka = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID,
    brokers: [process.env.KAFKA_BROKER],
    logLevel: parseInt(process.env.KAFKA_LOGLEVEL),
    requestTimeout: parseInt(process.env.KAFKA_REQUEST_TIMEOUT),
    sessionTimeout: parseInt(process.env.KAFKA_SESSION_TIMEOUT),
    enforceRequestTimeout: parseInt(process.env.KAFKA_ENFORCE_REQUEST_TIMEOUT),
    minBytes: parseInt(process.env.KAFKA_MIN_BYTES),
    maxBytes: parseInt(process.env.KAFKA_MAX_BYTES),
    maxWaitTimeInMs: parseInt(process.env.KAFKA_MAX_WAIT_TIMEOUT),
    retry: {
      initialRetryTime: parseInt(process.env.KAFKA_INITIAL_RETRY_TIME),
      retries: parseInt(process.env.KAFKA_RETRIES),
    },
  });
}

if (parseBoolean(process.env.DEBUG))
  console.log("consumerTopics", CONSUME_TOPICS);
var consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_TAG });
var run = async () => {
  await consumer.connect();
  await consumer.subscribe({
    topics: CONSUME_TOPICS,
    fromBeginning: parseBoolean(process.env.KAFKA_FROM_BEGINNING),
  });
  if (parseBoolean(process.env.DEBUG)) {
    let groupData = await consumer.describeGroup();
    console.log("groupData", groupData);
  }
  const checkStaleRowsId = setInterval(checkStaleRows, 60000);
  await consumer.run({
    eachMessage: async ({ topic, message, partition }) => {
      switch (topic) {
        case "xxxx-pon-interface-metrics":
          if (validContent(process.env.FORMAT_JSON, message.value.toString())) {
            let j = JSON.parse(message.value.toString());
            let t = "ponInterfaceMetricsTable";
            if (parseBoolean(process.env.DEBUG)) console.log(t, j);
            let olt = j["olt"];
            let onu = j["onu"];
            let ifType = j["if-type"];
            let subIfType = j["sub-if-type"];
            let name = j["name"];
            let type = j["type"];
            let timeStamp = j["time-stamp"];
            let inDiscards = parseInt(j["in-discards"]);
            let inErrors = parseInt(j["in-errors"]);
            let inPkts = parseInt(j["in-pkts"]);
            let inUnicastPkts = parseInt(j["in-unicast-pkts"]);
            let outDiscards = parseInt(j["out-discards"]);
            let outPkts = parseInt(j["out-pkts"]);
            let outUnicastPkts = parseInt(j["out-unicast-pkts"]);
            let gemportHecErrors = parseInt(j["xpon.gemport.hec-errors"]);
            let gemportInFrames = parseInt(j["xpon.gemport.in-frames"]);
            let gemportOutFrames = parseInt(j["xpon.gemport.out-frames"]);
            let gemportKeyErrors = parseInt(j["xpon.gemport.key-errors"]);
            let phyInBipErrors = parseInt(j["xpon.phy.in-bip-errors"]);
            let phyInBipProtWords = parseInt(
              j["xpon.phy.in-bip-protected-words"]
            );
            let phyInFecCodeWords = parseInt(j["xpon.phy.in-fec-codewords"]);
            let phyUncorrFecCodeWords = parseInt(
              j["xpon.phy.uncorrectable-fec-codewords"]
            );
            let phyPloamDownstreamMessages = parseInt(
              j["xpon.ploam.downstream-messages.total"]
            );
            let phyPloamUpstreamMessages = parseInt(
              j["xpon.ploam.upstream-messages.total"]
            );
            let row = await findABCRowInMib(t, olt, onu, name);
            if (row > 0) {
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run updating row", t, row);
              //await UpdateRowCellToMib(t, 4, [row], name);
              await UpdateRowCellToMib(t, 5, [row], ifType);
              await UpdateRowCellToMib(t, 6, [row], subIfType);
              await UpdateRowCellToMib(t, 7, [row], type);
              await UpdateRowCellToMib(t, 8, [row], timeStamp);
              await UpdateRowCellToMib(t, 9, [row], inDiscards);
              await UpdateRowCellToMib(t, 10, [row], inErrors);
              await UpdateRowCellToMib(t, 11, [row], inPkts);
              await UpdateRowCellToMib(t, 12, [row], inUnicastPkts);
              await UpdateRowCellToMib(t, 13, [row], outDiscards);
              await UpdateRowCellToMib(t, 14, [row], outPkts);
              await UpdateRowCellToMib(t, 15, [row], outUnicastPkts);
              await UpdateRowCellToMib(t, 16, [row], gemportHecErrors);
              await UpdateRowCellToMib(t, 17, [row], gemportInFrames);
              await UpdateRowCellToMib(t, 18, [row], gemportOutFrames);
              await UpdateRowCellToMib(t, 19, [row], gemportKeyErrors);
              await UpdateRowCellToMib(t, 20, [row], phyInBipErrors);
              await UpdateRowCellToMib(t, 21, [row], phyInBipProtWords);
              await UpdateRowCellToMib(t, 22, [row], phyInFecCodeWords);
              await UpdateRowCellToMib(t, 23, [row], phyUncorrFecCodeWords);
              await UpdateRowCellToMib(
                t,
                24,
                [row],
                phyPloamDownstreamMessages
              );
              await UpdateRowCellToMib(t, 25, [row], phyPloamUpstreamMessages);
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run updated row", t, row);
            } else {
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run adding new row", t);
              let newRow = await findNextIdxInMib(t);
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run adding new row", t, newRow);
              await AddRowToMib(t, [
                newRow,
                olt,
                onu,
                name,
                ifType,
                subIfType,
                type,
                timeStamp,
                inDiscards,
                inErrors,
                inPkts,
                inUnicastPkts,
                outDiscards,
                outPkts,
                outUnicastPkts,
                gemportHecErrors,
                gemportInFrames,
                gemportOutFrames,
                gemportKeyErrors,
                phyInBipErrors,
                phyInBipProtWords,
                phyInFecCodeWords,
                phyUncorrFecCodeWords,
                phyPloamDownstreamMessages,
                phyPloamUpstreamMessages,
              ]);
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run row added", t, newRow);
            }
          }
          break;
        case "xxxx-pon-gemport-metrics":
          if (validContent(process.env.FORMAT_JSON, message.value.toString())) {
            let j = JSON.parse(message.value.toString());
            let t = "gemportMetricsTable";
            if (parseBoolean(process.env.DEBUG)) console.log(t, j);
            let olt = j["olt"];
            let onu = j["onu"];
            let nameGemport = j["name"];
            let actualGemportId = parseInt(j["actual-gemport-id"]);
            let ifType = j["if-type"];
            let subIfType = j["sub-if-type"];
            let timeStamp = j["time-stamp"];
            let vAniSideInFrames = parseInt(j["v-ani-side.in-frames"]);
            let vAniSideOutFrames = parseInt(j["v-ani-side.out-frames"]);
            let row = await findABCRowInMib(t, olt, onu, actualGemportId);
            if (row > 0) {
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run updating row", t, row);
              //await UpdateRowCellToMib(t, 4, [row], actualGemportId);
              await UpdateRowCellToMib(t, 5, [row], nameGemport);
              await UpdateRowCellToMib(t, 6, [row], ifType);
              await UpdateRowCellToMib(t, 7, [row], subIfType);
              await UpdateRowCellToMib(t, 8, [row], timeStamp);
              await UpdateRowCellToMib(t, 9, [row], vAniSideInFrames);
              await UpdateRowCellToMib(t, 10, [row], vAniSideOutFrames);
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run updated row", t, row);
            } else {
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run adding new row", t);
              let newRow = await findNextIdxInMib(t);
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run adding new row", t, newRow);
              await AddRowToMib(t, [
                newRow,
                olt,
                onu,
                actualGemportId,
                nameGemport,
                ifType,
                subIfType,
                timeStamp,
                vAniSideInFrames,
                vAniSideOutFrames,
              ]);
              if (parseBoolean(process.env.DEBUG))
                console.log("consumer.run row added", t, newRow);
            }
          }
          break;
        default:
          if (parseBoolean(process.env.DEBUG))
            console.error("consumer.run topic not implemented", topic);
          break;
      }
    },
  });
};

// main
run().catch((e) =>
  console.error("consumer.run failed to process topic message(s)", e)
);

//async function init() {
//  while (true) {
//    await sleep(1000);
//  }
//}
//
//function sleep(ms) {
//  return new Promise((resolve) => {
//    setTimeout(resolve, ms);
//  });
//}

// error handling
const errorTypes = ["unhandledRejection", "uncaughtException"];
const signalTraps = ["SIGTERM", "SIGINT", "SIGQUIT", "SIGHUP"];

errorTypes.forEach((errType) => {
  process.on(errType, async (e) => {
    try {
      console.error("Error: ${errType}", e);
      await consumer.disconnect();
      if (snmpAgent != null) {
        snmpAgent.close();
      }
      process.exit(0);
    } catch (_) {
      process.exit(1);
    }
  });
});

signalTraps.forEach((sigType) => {
  process.once(sigType, async () => {
    switch (sigType) {
      case "SIGINT":
        console.log("aborting");
        try {
          await consumer.disconnect();
          if (snmpAgent != null) {
            snmpAgent.close();
          }
        } finally {
          process.kill(process.pid, sigType);
          process.exit(1);
        }
        break;
      case "SIGHUP":
        console.log("Dumping MIBs");
        try {
          if (snmpAgent != null) {
            if (mib != null) {
              console.log(
                "MIB Dump",
                mib.dump({
                  leavesOnly: true,
                  showProviders: true,
                  showValues: true,
                  showTypes: true,
                })
              );
            }
          }
        } catch (e) {}
        break;
      case "SIGTERM" || "SIGQUIT":
        console.log("terminating");
        try {
          await consumer.disconnect();
          if (snmpAgent != null) {
            snmpAgent.close();
          }
        } finally {
          process.kill(process.pid, sigType);
          process.exit(1);
        }
        break;
      default:
        console.log("unknown");
        try {
          await consumer.disconnect();
          if (snmpAgent != null) {
            snmpAgent.close();
          }
        } finally {
          process.kill(process.pid, sigType);
          process.exit(1);
        }
    }
  });
});
