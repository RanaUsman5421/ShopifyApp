// @ts-check
import { MongoClient } from "mongodb";

import { DB_NAME, DB_URL } from "./config.js";

/** @type {Promise<MongoClient> | null} */
let mongoClientPromise = null;
/** @type {{ connected: boolean; error: string | null }} */
let mongoConnectionState = {
  connected: false,
  error: null,
};

/** @param {unknown} error */
export function getMongoErrorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Failed to connect to MongoDB";
}

export async function connectToMongoDB() {
  try {
    if (!mongoClientPromise) {
      const client = new MongoClient(DB_URL, {
        serverSelectionTimeoutMS: 10000,
      });
      mongoClientPromise = client.connect();
    }

    const client = await mongoClientPromise;
    mongoConnectionState = {
      connected: true,
      error: null,
    };
    return client.db(DB_NAME);
  } catch (error) {
    mongoClientPromise = null;
    mongoConnectionState = {
      connected: false,
      error: getMongoErrorMessage(error),
    };
    console.error("MongoDB connection error:", error);
    throw new Error(getMongoErrorMessage(error));
  }
}

export function getMongoConnectionState() {
  return mongoConnectionState;
}
