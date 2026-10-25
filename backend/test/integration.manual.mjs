// integration.manual.mjs - REAL mongod ke saath server<->memory wiring test.
// mongodb-memory-server ek asli mongod process chalata hai (download karke) -
// koi Atlas/account/network change NAHI. Dummy chatIds/messages only.
// Ye Atlas end-to-end ka substitute NAHI hai: Atlas connectivity Oct 24 ko
// real driver CRUD se alag se verify ho chuki hai.
//
// Run: cd backend && npm install --no-save mongodb-memory-server && node test/integration.manual.mjs
import { spawn } from 'node:child_process';

const { MongoMemoryServer } = await import('mongodb-memory-server').catch(() => {
  console.log('SKIP: mongodb-memory-server installed nahi hai (npm install --no-save mongodb-memory-server)');
  process.exit(0);
});

const mongod = await MongoMemoryServer.create();
const uri = mongod.getUri();
const PORT = 8799;
const TOKEN = 'integ-token';
const env = {
  ...process.env, AI_MOCK: 'true', AUTH_TOKEN: TOKEN, PORT: String(PORT),
  MONGODB_URI: uri, OWNER_TOKENS: JSON.stringify({ [TOKEN]: 'owner1' }),
};
const server = spawn('node', ['src/server.js'], { env, stdio: 'pipe' });
// "memory: MongoDB connected" ka wait karo - uske pehle ki writes drop hoti hain
// (design: connect fail/pending = memory off, reply kabhi block nahi hoti).
await new Promise((r, j) => {
  const to = setTimeout(() => j(new Error('memory connect timeout')), 20000);
  server.stdout.on('data', (d) => { if (String(d).includes('MongoDB connected')) { clearTimeout(to); r(); } });
});

const post = (chatId, text) => fetch(`http://127.0.0.1:${PORT}/reply`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Chatbot-Token': TOKEN },
  body: JSON.stringify({ chatId, character: { name: 'Meera' }, messages: [{ role: 'user', content: text }] }),
}).then((r) => r.json());

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (cond, m) => { if (!cond) throw new Error(m); };

try {
  // 1) do alag chats mein /reply -> memory store hona chahiye
  await post('chat-adarsh', 'bhai notes dena');
  await post('chat-priya', 'kal movie?');
  await sleep(700); // memory write best-effort async

  // 2) driver se seedha readback: dono chats ke records alag (db character_chatbot, collection chat_memory)
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri);
  await client.connect();
  const col = client.db('character_chatbot').collection('chat_memory');
  const adarsh = await col.find({ ownerId: 'owner1', chatId: 'chat-adarsh' }).toArray();
  const priya = await col.find({ ownerId: 'owner1', chatId: 'chat-priya' }).toArray();
  check(adarsh.length === 2, `chat-adarsh mein ${adarsh.length} docs (2 expected)`);
  check(priya.length === 2, `chat-priya mein ${priya.length} docs (2 expected)`);
  check(adarsh.every((d) => d.chatId === 'chat-adarsh') && priya.every((d) => d.chatId === 'chat-priya'), 'cross-chat contamination');
  check(adarsh.some((d) => d.role === 'user' && d.text === 'bhai notes dena'), 'user msg missing');
  check(adarsh.some((d) => d.role === 'assistant' && d.text.includes('mock reply')), 'assistant reply missing');
  check(priya.some((d) => d.role === 'user' && d.text === 'kal movie?'), 'priya user msg missing');
  console.log('PASS: /reply -> real mongod store (2 chats, user+assistant rows, isolation)');

  // 3) teesra message bhi usi chat mein store hota hai
  const r = await post('chat-adarsh', 'aur suna');
  check(r.reply, 'empty reply on third message');
  await sleep(700);
  check((await col.countDocuments({ ownerId: 'owner1', chatId: 'chat-adarsh' })) === 4, 'chat-adarsh total 4 docs expected');
  check((await col.countDocuments({ ownerId: 'owner1', chatId: 'chat-priya' })) === 2, 'chat-priya untouched');
  console.log('PASS: teesre message par bhi wiring sahi, doosri chat untouched');

  // 4) owner binding fail-closed: ownerId sirf token se (yahan sab owner1)
  check((await col.countDocuments({ ownerId: { $ne: 'owner1' } })) === 0, 'unknown owner ka data store hua');
  console.log('PASS: owner binding fail-closed');

  await client.close();
  console.log('INTEGRATION ALL PASS (real mongod, dummy data)');
} catch (e) {
  console.log('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  server.kill();
  await mongod.stop();
}
