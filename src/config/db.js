import { MongoClient } from "mongodb";

let client = null;
let db = null;

export async function connectDB() {
  if (db) {
    return db;
  }

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.DB_NAME || "wedplan";

  if (!uri) {
    throw new Error("MONGODB_URI is not defined in environment variables");
  }

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);
  console.log(`Connected to MongoDB database: ${dbName}`);

  // Create useful indexes for queries and constraints
  await createIndexes();

  return db;
}

async function createIndexes() {
  try {
    const services = db.collection("services");
    await services.createIndex({ status: 1 });
    await services.createIndex({ vendorId: 1 });
    await services.createIndex({ isActive: 1 });
    await services.createIndex({ category: 1 });

    const bookings = db.collection("bookings");
    await bookings.createIndex({ customerId: 1 });
    await bookings.createIndex({ vendorId: 1 });
    await bookings.createIndex({ serviceId: 1 });

    const transactions = db.collection("transactions");
    await transactions.createIndex(
      { stripeSessionId: 1 },
      { unique: true, sparse: true }
    );
    await transactions.createIndex({ vendorId: 1 });
  } catch (err) {
    console.warn("Index creation warning:", err.message);
  }
}

export function getDb() {
  if (!db) {
    throw new Error("Database not connected. Call connectDB() first.");
  }
  return db;
}

export function getUsersCollection() {
  return getDb().collection("users");
}

export function getServicesCollection() {
  return getDb().collection("services");
}

export function getBookingsCollection() {
  return getDb().collection("bookings");
}

export function getTransactionsCollection() {
  return getDb().collection("transactions");
}

export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
