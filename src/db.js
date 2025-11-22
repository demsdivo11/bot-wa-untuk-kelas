const { MongoClient, ObjectId } = require("mongodb");

function createDb(config) {
  const uri = config.mongoUri;
  const dbName = config.mongoDbName || "kelas105";
  const collectionName = config.mongoCollection || "jadwal";
  const tasksCollectionName = config.mongoTasksCollection || "tugas";
  const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000
  });

  let db = null;

  async function getDb() {
    if (!uri) {
      throw new Error("MongoDB URI belum diisi di config.json (mongoUri).");
    }
    if (!db) {
      await client.connect();
      db = client.db(dbName);
    }
    return db;
  }

  async function saveSchedule(day, subjects) {
    const database = await getDb();
    const col = database.collection(collectionName);
    const doc = {
      day,
      subjects,
      updatedAt: new Date()
    };
    await col.updateOne({ day }, { $set: doc }, { upsert: true });
    return doc;
  }

  async function addTask(subject, description, deadline) {
    const database = await getDb();
    const col = database.collection(tasksCollectionName);
    const doc = {
      subject,
      description,
      deadline,
      remindersSent: [],
      createdAt: new Date()
    };
    const res = await col.insertOne(doc);
    return { ...doc, _id: res.insertedId };
  }

  async function getAllTasks() {
    const database = await getDb();
    const col = database.collection(tasksCollectionName);
    const docs = await col
      .find({}, { projection: { _id: 1, subject: 1, description: 1, deadline: 1, remindersSent: 1 } })
      .sort({ deadline: 1 })
      .toArray();
    return docs;
  }

  async function markReminderSent(id, label) {
    const database = await getDb();
    const col = database.collection(tasksCollectionName);
    await col.updateOne(
      { _id: new ObjectId(id) },
      { $addToSet: { remindersSent: label } }
    );
  }

  async function deletePastTasks() {
    const database = await getDb();
    const col = database.collection(tasksCollectionName);
    const res = await col.deleteMany({ deadline: { $lt: new Date() } });
    return res.deletedCount;
  }

  async function getAllSchedules() {
    const database = await getDb();
    const col = database.collection(collectionName);
    const docs = await col
      .find({}, { projection: { _id: 0 } })
      .sort({ day: 1 })
      .toArray();
    return docs;
  }

  return {
    getDb,
    saveSchedule,
    getAllSchedules,
    addTask,
    getAllTasks,
    markReminderSent,
    deletePastTasks,
    client
  };
}

module.exports = { createDb };
