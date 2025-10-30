"use strict";

const http2 = require("http2");
const WebSocket = require("ws");
const axios = require("axios");
const fs = require("fs").promises;

let mfaToken = null;

const connectionPool = [];
const POOL_SIZE = 5;

let vanity = {
vanity: "",
event: null
};

const guilds = {};

const token = "token gir abicim.";
const server = "sunucu id abicim.";
const webhookUrl = "webhook abicim.";

async function extractJsonFromString(str) {
  const jsonRegex = /{[^{}]*}|\[[^\[\]]*\]/g;
  const matches = str.match(jsonRegex) || [];
  const results = [];
  
  for (const match of matches) {
      try {
          const parsed = JSON.parse(match);
          if (parsed) results.push(parsed);
      } catch {}
  }
  
  return results;
}

const readMFAToken = async () => { 
try { 
  const fileContent = await fs.readFile('mfa.json', 'utf8');
  const jsonData = JSON.parse(fileContent);
  mfaToken = jsonData.token;
  return mfaToken;
} catch (e) { 
  console.error("MFA token okunamadi:", e.message);
} 
return mfaToken;
};

const createConnection = (index) => {
const client = http2.connect('https://canary.discord.com');

client.on('error', () => {
  setTimeout(() => {
    connectionPool[index] = createConnection(index);
  }, 1000);
});

client.on('close', () => {
  setTimeout(() => {
    connectionPool[index] = createConnection(index);
  }, 1000);
});

return client;
};

const createConnectionPool = () => {
for (let i = 0; i < POOL_SIZE; i++) {
  connectionPool[i] = createConnection(i);
}
};

const sendHttp2Request = (client, method, path, body, headers = {}) => {
return new Promise((resolve) => {
  const defaultHeaders = {
    ':method': method,
    ':path': path,
    'authorization': token,
    'content-type': 'application/json',
    ...headers
  };

  const req = client.request(defaultHeaders);
  
  let data = '';
  req.on('data', (chunk) => {
    data += chunk;
  });
  
  req.on('end', () => {
    resolve(data);
  });
  
  req.on('error', () => {
    resolve('');
  });
  
  if (body) {
    req.write(JSON.stringify(body));
  }
  req.end();
});
};

const sendParallelRequests = async (vanityCode) => {
const requestBody = { 
  code: vanityCode,
  weight: 255,
  exclusive: true
};
const headers = {
  'x-discord-mfa-authorization': mfaToken,
  'x-fingerprint': Date.now().toString(),
  'cookie': `__Secure-recent_mfa=${mfaToken}; __Secure-mfa_token=${mfaToken}; __Secure-mfa_type=totp; __Secure-mfa_verified=${Date.now()}`,
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  'x-super-properties': 'eyJvcyI6IldpbmRvd3MiLCJicm93c2VyIjoiQ2hyb21lIiwiZGV2aWNlIjoiIiwic3lzdGVtX2xvY2FsZSI6InRyLVRSIiwiY2xpZW50X21vZHMiOmZhbHNlLCJicm93c2VyX3VzZXJfYWdlbnQiOiJNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTMyLjAuMC4wIFNhZmFyaS81MzcuMzYiLCJicm93c2VyX3ZlcnNpb24iOiIxMzIuMC4wLjAiLCJvc192ZXJzaW9uIjoiMTAifQ=='
};

const promises = [];
for (let i = 0; i < 5; i++) {
  promises.push(
    sendHttp2Request(
      connectionPool[i], 
      'PATCH', 
      `/api/v8/guilds/${server}/vanity-url`, 
      requestBody, 
      headers
    )
  );
}

const responses = await Promise.all(promises);
return responses;
};

const sendWebhookMessage = async (vanityUrl, responses) => {
try {
  let responseText = "";
  
  for (let i = 0; i < responses.length; i++) {
    let jsonResult;
    try {
      const extractedJson = await extractJsonFromString(responses[i]);
      jsonResult = extractedJson.find(e => e.code) || 
                  extractedJson.find(e => e.message) || 
                  extractedJson[0] || 
                  responses[i];
    } catch {
      jsonResult = responses[i];
    }
    
    responseText += `**${i + 1}.** \`${JSON.stringify(jsonResult)}\`\n`;
  }

  const now = new Date();
  const timestampWithSeconds = Math.floor(now.getTime() / 1000);

  const embed = {
    title: "stezy bots",
    color: 0x000000,
    fields: [
      {
        name: "Vanity",
        value: vanityUrl,
        inline: true
      },
      {
        name: "Responses",
        value: responseText,
        inline: false
      },
      {
        name: "Credits",
        value: "@xstezy Production",
        inline: false
      },
      {
        name: "Timestamp",
        value: `<t:${timestampWithSeconds}:F>`,
        inline: false
      }
    ],
    timestamp: new Date().toISOString()
  };

  await axios.post(webhookUrl, {
    content: "@everyone Beni öldürmek belki mümkündür, küçültmek **asla** mümkün değildir. " + vanityUrl,
    embeds: [embed]
  });
} catch (error) {
  console.error("Webhook mesajı gönderilemedi:", error.message);
}
};

createConnectionPool();
readMFAToken();

setInterval(() => {
readMFAToken();
}, 10000);

const websocket = new WebSocket("wss://gateway.discord.gg/");

websocket.onclose = (event) => {
console.log(`ws connection closed ${event.reason} ${event.code}`);
process.exit();
};

websocket.onmessage = async (message) => {
const { d, op, t } = JSON.parse(message.data);

if (t == "GUILD_UPDATE") {
  const find = guilds[d.guild_id];
  if (find && find !== d.vanity_url_code) {
    const responses = await sendParallelRequests(find);
    await sendWebhookMessage(find, responses);
    vanity.vanity = find;
  }
} else if (t === "READY") {
  d.guilds.forEach((guild) => {
    if (guild.vanity_url_code) {
      guilds[guild.id] = guild.vanity_url_code;
    }
  });
  console.log(guilds);
}

if (op === 10) {
  websocket.send(JSON.stringify({
    op: 2,
    d: {
      token: token,
      intents: 513 << 0,
      properties: {
        os: "Linux",
        browser: "Firefox",
        device: "Firefox",
      },
      weight: 255,
      exclusive: true,
    },
  }));

  setInterval(() => websocket.send(JSON.stringify({ 
    op: 1, 
    d: {}, 
    s: null, 
    t: "heartbeat" 
  })), d.heartbeat_interval);
} else if (op === 7) {
  process.exit();
}
};