# WedPlan API Documentation

This document describes all API endpoints implemented in the **WedPlan Server**.

---

## Base URLs & Production Endpoints

- **Live Server (API)**: `https://wedplan-server-ruddy.vercel.app/api`
- **Health Check URL**: `https://wedplan-server-ruddy.vercel.app/api/health`
- **Stripe Webhook Endpoint**: `https://wedplan-server-ruddy.vercel.app/api/webhooks/stripe`
- **Local Development**: `http://localhost:5000/api`

### Production Environment Variables
- `CLIENT_URL` = `https://wedplan-client-pearl.vercel.app`
- `BETTER_AUTH_JWKS_URL` = `https://wedplan-client-pearl.vercel.app/api/auth/jwks`
- `BETTER_AUTH_ISSUER` = `https://wedplan-client-pearl.vercel.app`

---

## Authentication & Authorization Architecture

- Authentication is handled via Bearer JWT tokens in the `Authorization` header: `Authorization: Bearer <token>`.
- JWT tokens are verified against Better Auth's remote JWKS endpoint using `jose.createRemoteJWKSet`.
- Verified user record is loaded directly from the MongoDB `users` collection.
- Roles (`customer`, `vendor`, `admin`), `isBlocked` flags, and subscription details are strictly determined by MongoDB, never trusted from the client payload.
- All user IDs (`vendorId`, `customerId`) are uniformly referenced as strings for cross-adapter compatibility.

---

## Overview of Endpoints

### Public Endpoints
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health status |
| `GET` | `/api/categories` | Public | 6 wedding service categories |
| `GET` | `/api/services` | Public | List approved & active services (search, filter, sort, paginate) |
| `GET` | `/api/services/featured` | Public | 6 latest approved & active services |
| `GET` | `/api/services/:id` | Public | Single approved & active service with sanitized vendor info |

### General Protected Endpoints
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/me` | Authenticated | Current user profile and DB-verified role |

### Vendor Service Management (`/api/vendor`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `POST` | `/api/vendor/services` | Vendor | Create new service (pending approval, free-plan limit enforced) |
| `GET` | `/api/vendor/services` | Vendor | List all vendor's own services (all statuses, newest first) |
| `GET` | `/api/vendor/services/:id` | Vendor | View a single own service |
| `PATCH` | `/api/vendor/services/:id` | Vendor | Update editable service details |
| `PATCH` | `/api/vendor/services/:id/availability` | Vendor | Toggle availability (`isActive`: boolean) |
| `DELETE` | `/api/vendor/services/:id` | Vendor | Delete own service |
| `GET` | `/api/vendor/subscription` | Vendor | View subscription status, expiry, and payment history |

### Stripe Payments & Subscriptions (`/api/payments`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `POST` | `/api/payments/create-checkout-session` | Vendor | Generate Stripe Checkout session for Premium upgrade |
| `GET` | `/api/payments/session-status` | Vendor | Query session payment status and DB premium state |
| `POST` | `/api/payments/cancel-subscription` | Vendor | Cancel subscription at period end (retains access until expiry) |

### Stripe Webhook (`/api/webhooks`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `POST` | `/api/webhooks/stripe` | Stripe Webhook | Raw body endpoint verifying Stripe signature to activate/renew/cancel premium |

### Customer Bookings (`/api/bookings`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `POST` | `/api/bookings` | Customer | Submit booking request (prevents duplicate active booking) |
| `GET` | `/api/bookings/my` | Customer | Customer's booking history with service preview & vendor details |
| `GET` | `/api/bookings/:id` | Customer / Vendor | Detailed booking information (owner only) |
| `PATCH` | `/api/bookings/:id/cancel` | Customer | Cancel a pending booking (atomic, 409 if already processed) |

### Vendor Bookings (`/api/vendor`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/vendor/bookings` | Vendor | List received bookings (with customer info, optional `?status=`) |
| `PATCH` | `/api/vendor/bookings/:id/status` | Vendor | Accept or reject a pending booking (atomic, 409 if already processed) |

### Dashboard Statistics
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/vendor/stats` | Vendor | Vendor metrics (services, active, bookings, subscription) |
| `GET` | `/api/customer/stats` | Customer | Customer metrics (total, pending, accepted, rejected, cancelled) |
| `GET` | `/api/admin/stats` | Admin | Platform overview metrics (users, vendors, customers, services, transactions) |

### Admin Platform Management (`/api/admin`)
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/admin/users` | Admin | List users with search (name/email), role filter, and pagination |
| `GET` | `/api/admin/users/:id` | Admin | Get user details and metrics (service or booking count) |
| `PATCH` | `/api/admin/users/:id/block` | Admin | Block user and immediately revoke Better Auth sessions |
| `PATCH` | `/api/admin/users/:id/unblock` | Admin | Unblock a user |
| `GET` | `/api/admin/services` | Admin | List all services with status filter, category, and search |
| `GET` | `/api/admin/services/:id` | Admin | Service details with vendor contact info (email included) |
| `PATCH` | `/api/admin/services/:id/status` | Admin | Moderate service status (`approved`, `rejected`, `pending`) |
| `DELETE` | `/api/admin/services/:id` | Admin | Delete inappropriate service |
| `GET` | `/api/admin/transactions` | Admin | Read-only platform transactions list |

---

## Detailed Stripe Payment Endpoints Documentation

### 1. Create Checkout Session

#### `POST /api/payments/create-checkout-session`
Creates a Stripe Checkout Session in subscription mode. The vendor is redirected to Stripe to enter payment details.
- **Role**: `vendor`
- **Headers**: `Authorization: Bearer <token>`
- **Rules**:
  - `vendorId` is set strictly from `req.user.id`.
  - Vendors already on an active Premium plan receive `409 Conflict`.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "url": "https://checkout.stripe.com/c/pay/cs_test_a1b2c3d4..."
  }
  ```
- **Error Response (409 Conflict)**:
  ```json
  {
    "success": false,
    "message": "You already have an active Premium subscription."
  }
  ```

---

### 2. Session Status (Payment Success Page)

#### `GET /api/payments/session-status`
Used by the frontend Payment Success page to confirm payment and check whether the backend webhook has activated Premium in MongoDB.
- **Role**: `vendor`
- **Query Parameters**:
  - `session_id` *(string, required)*: The Stripe Checkout session ID from URL.
- **Security Guarantee**: This endpoint NEVER activates Premium directly. It only reports current database state while the client polls.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "paymentStatus": "paid",
    "isPremium": true,
    "subscriptionExpiresAt": "2026-12-22T19:30:00.000Z"
  }
  ```

---

### 3. Cancel Subscription

#### `POST /api/payments/cancel-subscription`
Schedules subscription cancellation at the end of the current billing period.
- **Role**: `vendor`
- **Rules**:
  - Sets `cancel_at_period_end: true` in Stripe.
  - Premium access remains active until `subscriptionExpiresAt`.
  - When the period ends, Stripe issues `customer.subscription.deleted`, which downgrades the user.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Subscription scheduled to cancel at the end of the current billing period. Premium access remains active until expiration.",
    "subscriptionExpiresAt": "2026-12-22T19:30:00.000Z",
    "cancelAtPeriodEnd": true
  }
  ```

---

### 4. Vendor Subscription Details

#### `GET /api/vendor/subscription`
Returns the vendor's active plan, subscription expiry, cancellation schedule, and past transactions.
- **Role**: `vendor`
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "plan": "premium",
    "isPremium": true,
    "subscriptionExpiresAt": "2026-12-22T19:30:00.000Z",
    "cancelAtPeriodEnd": false,
    "transactions": [
      {
        "id": "6741b2e3f5a8c12345678950",
        "plan": "premium",
        "amount": 29,
        "currency": "usd",
        "status": "completed",
        "stripeSessionId": "cs_test_...",
        "createdAt": "2026-11-22T19:30:00.000Z"
      }
    ]
  }
  ```

---

### 5. Stripe Webhook Listener

#### `POST /api/webhooks/stripe`
- **Live Production URL**: `https://wedplan-server-ruddy.vercel.app/api/webhooks/stripe`
- **Description**: Receives raw event payloads directly from Stripe.
- **Authentication**: Verified cryptographically with `stripe.webhooks.constructEvent` using `STRIPE_WEBHOOK_SECRET` and the `stripe-signature` header.
- **Handled Events (5)**:
  1. `checkout.session.completed`: Activates Premium in DB and writes transaction.
  2. `invoice.paid`: Extends subscription period for renewals and logs renewal transaction.
  3. `invoice.payment_failed`: Logs failed transaction without extending access.
  4. `customer.subscription.updated`: Keeps `subscriptionExpiresAt` and `cancelAtPeriodEnd` in sync.
  5. `customer.subscription.deleted`: Downgrades vendor to "free" and deactivates services exceeding the free plan limit (retains the 3 newest non-rejected services).
- **Response**: `200 OK` (`{ "received": true }`).

---

## Universal Error Response Format

All error responses adhere to:
```json
{
  "success": false,
  "message": "Descriptive error message"
}
```
HTTP status codes used:
- `400`: Bad Request (invalid parameter, malformed ObjectId, or invalid webhook signature)
- `401`: Unauthorized (missing, invalid, or expired JWT token)
- `403`: Forbidden (insufficient role privileges, blocked account, or accessing another user's session)
- `404`: Not Found (resource or subscription not found)
- `409`: Conflict (already premium or duplicate active booking)
- `500`: Internal Server Error
