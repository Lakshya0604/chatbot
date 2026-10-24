// memory.js - per-contact conversation memory (MongoDB).
//
// Design goals (user requirement: "har contact ki alag memory ho - Adarsh wali
// baat kisi aur chat mein mix na ho"):
//   - Har message {ownerId, chatId} DONO ke saath store hota hai. Har read/write
//     query mein dono filter lagte hain - koi "global" query hi nahi hai.
//   - chatId platform adapter ka fail-closed stable id hai (display name KABHI nahi).
//   - Retention/deletion owner ke haath mein: clearChat (ek contact) aur
//     clearAllForOwner (poora data wipe) dono hain.
//   - Ye module kisi bhi platform se text tabhi leta hai jab consent state
//     active ho - gate engine mein hai, memory sirf storage hai.
//
// Tests real MongoDB ke bina chalte hain (collection interface inject hoti hai).
// Real wiring connectMongoMemory() se hoti hai jab MONGODB_URI set ho.

const DEFAULT_LIMIT = 20;

export function createMemoryStore(collection) {
  async function appendMessage({ ownerId, chatId, role, text, ts }) {
    if (!ownerId || !chatId) {
      throw new Error('memory: ownerId aur chatId dono required hain (fail-closed identity)');
    }
    await collection.insertOne({ ownerId, chatId, role, text, ts: ts || new Date() });
  }

  // Sirf is owner + is chat ke messages, purane -> naye order mein.
  async function getRecentMessages({ ownerId, chatId, limit = DEFAULT_LIMIT }) {
    if (!ownerId || !chatId) throw new Error('memory: ownerId aur chatId required hain');
    const docs = await collection
      .find({ ownerId, chatId })
      .sort({ ts: -1, _id: -1 })
      .limit(limit)
      .toArray();
    return docs.reverse().map((d) => ({ role: d.role, text: d.text, ts: d.ts }));
  }

  async function clearChat({ ownerId, chatId }) {
    const r = await collection.deleteMany({ ownerId, chatId });
    return r.deletedCount;
  }

  async function clearAllForOwner(ownerId) {
    const r = await collection.deleteMany({ ownerId });
    return r.deletedCount;
  }

  return { appendMessage, getRecentMessages, clearChat, clearAllForOwner };
}

// Real MongoDB wiring. Dynamic import taaki tests bina mongodb package ke bhi
// module load kar sakein (unit tests fake collection use karte hain).
export async function connectMongoMemory(uri, dbName = 'character_chatbot') {
  const { MongoClient } = await import('mongodb');
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  const collection = client.db(dbName).collection('chat_memory');
  await collection.createIndex({ ownerId: 1, chatId: 1, ts: 1 });
  return { store: createMemoryStore(collection), client };
}
