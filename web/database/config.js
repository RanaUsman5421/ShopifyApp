export const DB_URL = process.env.MONGODB_URI || "mongodb://LionEx:edace9553b@31.220.54.51:27017/lionex-db-created-by-RajaSab?authSource=admin&replicaSet=rs0";
export const DB_NAME = process.env.DB_NAME || new URL(DB_URL).pathname.replace(/^\/+/, "") || undefined;
export const ORDERS_COLLECTION = "ShopifyOrders";
export const INSTALLED_SHOPS_COLLECTION = "InstalledShops";
export const AGENDA_JOBS_COLLECTION = "AgendaJobs";
