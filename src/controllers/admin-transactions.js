import { ObjectId } from "mongodb";
import {
  getTransactionsCollection,
  getUsersCollection,
} from "../config/db.js";
import { TRANSACTION_STATUS } from "../utils/constants.js";

/**
 * GET /api/admin/transactions
 * Role: admin
 * Strictly READ-ONLY endpoint to review platform payment transactions.
 * Supports status filtering and pagination, sorted newest first.
 * Attaches vendor name, businessName, and email.
 */
export async function getAdminTransactions(req, res, next) {
  try {
    const { status } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const skip = (page - 1) * limit;

    const query = {};
    if (status && Object.values(TRANSACTION_STATUS).includes(status.toLowerCase().trim())) {
      query.status = status.toLowerCase().trim();
    }

    const transactionsCollection = getTransactionsCollection();
    const usersCollection = getUsersCollection();

    const total = await transactionsCollection.countDocuments(query);
    const rawTransactions = await transactionsCollection
      .find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .toArray();

    if (rawTransactions.length === 0) {
      return res.json({
        success: true,
        total: 0,
        page,
        limit,
        transactions: [],
        items: [],
      });
    }

    const vendorIds = rawTransactions.map((t) => t.vendorId).filter(Boolean);

    const conditions = [];
    for (const vid of vendorIds) {
      conditions.push({ _id: vid }, { id: vid });
      if (ObjectId.isValid(vid)) {
        conditions.push({ _id: new ObjectId(vid) });
      }
    }

    const vendors = conditions.length > 0
      ? await usersCollection
          .find(
            { $or: conditions },
            {
              projection: {
                _id: 1,
                id: 1,
                name: 1,
                businessName: 1,
                email: 1,
              },
            }
          )
          .toArray()
      : [];

    const vendorMap = new Map();
    for (const v of vendors) {
      const info = {
        name: v.name || "",
        businessName: v.businessName || v.name || "",
        email: v.email || "",
      };
      if (v._id) vendorMap.set(v._id.toString(), info);
      if (v.id) vendorMap.set(v.id, info);
    }

    const transactions = rawTransactions.map((t) => {
      const vidKey = t.vendorId?.toString();
      const vendorInfo = vendorMap.get(vidKey) || {
        name: "Unknown Vendor",
        businessName: "WedPlan Vendor",
        email: "",
      };

      return {
        id: t._id.toString(),
        _id: t._id,
        vendorId: t.vendorId,
        plan: t.plan || "premium",
        amount: t.amount,
        currency: t.currency || "usd",
        stripeSessionId: t.stripeSessionId || null,
        stripeSubscriptionId: t.stripeSubscriptionId || null,
        status: t.status,
        createdAt: t.createdAt,
        vendor: vendorInfo,
        vendorName: vendorInfo.businessName || vendorInfo.name,
        vendorEmail: vendorInfo.email,
      };
    });

    res.json({
      success: true,
      total,
      page,
      limit,
      transactions,
      items: transactions,
    });
  } catch (error) {
    next(error);
  }
}
