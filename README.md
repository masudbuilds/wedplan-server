# WedPlan Server

Backend REST API service for **WedPlan** — an end-to-end role-based wedding planning platform connecting couples with wedding vendors, moderated by platform administrators.

Built with **Node.js 20+**, **Express.js**, the official **MongoDB driver** (no Mongoose), and secure **Stripe Checkout** subscription webhooks.

---

## Repository Links & Live URLs

- **Live Server URL (API)**: `https://wedplan-server-ruddy.vercel.app`
- **Health Check URL**: `https://wedplan-server-ruddy.vercel.app/api/health`
- **Live Client URL (Frontend)**: `https://wedplan-client-pearl.vercel.app`
- **Stripe Webhook Endpoint**: `https://wedplan-server-ruddy.vercel.app/api/webhooks/stripe`
- **Server Repository**: `https://github.com/masudbuilds/wedplan-server`
- **Client Repository**: `https://github.com/masudbuilds/wedplan-client`

---

## Important Features

- **Decoupled Architecture**: Fully separated Express backend communicating with a Next.js frontend via JSON APIs with CORS whitelist protection.
- **Strict Role-Based Authorization**: Distinct access controls for **Customers**, **Vendors**, and **Administrators** with server-side role verification on every private endpoint.
- **Better Auth Integration**: Token validation via public key cryptography using remote JWKS (`jose.createRemoteJWKSet`), with user permissions (`role`, `isBlocked`, `subscriptionPlan`) verified directly from MongoDB.
- **Service Discovery & Catalog**: Public search (regex-safe case-insensitive), category filtering across 6 official wedding categories, location search, price sorting, pagination, and sanitized vendor profiles.
- **Vendor Service Quotas**: Free-tier vendors can publish up to 3 active services; upgrading to Premium unlocks unlimited service listings.
- **Booking Request Workflow**: Race-condition-free booking requests enforced by MongoDB partial unique indexes, prevent self-booking, with full lifecycle status tracking (`pending`, `accepted`, `rejected`, `cancelled`).
- **Cryptographic Stripe Subscription**: Premium subscriptions activated **strictly** via verified Stripe webhook signatures (`stripe.webhooks.constructEvent`), preventing client-side spoofing.
- **Admin Moderation & Security Safeguards**: Platform metrics, user management with search/role filters, account blocking with automatic session revocation, service review (approve/reject/delete), and read-only financial records.

---

## Technology Stack

- **Runtime**: Node.js v20+ (ES Modules)
- **Framework**: Express.js 5
- **Database**: MongoDB (Official `mongodb` Node.js driver v7+)
- **Authentication**: `jose` (JWT verification with remote JWKS)
- **Payments**: Stripe Node SDK (Checkout sessions & signature-verified webhooks)
- **Security**: `helmet` security headers, strict `cors` policies, MongoDB parameterization, regex escaping

---

## Environment Variables

Configure environment variables in a `.env` file in the server root. Never commit `.env` to Git.

| Variable | Description |
|---|---|
| `PORT` | Local port number for Express server to listen on (default `5000`) |
| `MONGODB_URI` | MongoDB connection string (local or MongoDB Atlas connection URI) |
| `DB_NAME` | MongoDB database name (e.g. `wedplan`) |
| `CLIENT_URL` | Whitelisted client origin(s) for CORS (supports comma-separated list, e.g. `http://localhost:3000,https://wedplan-client-pearl.vercel.app`) |
| `BETTER_AUTH_JWKS_URL` | Remote JWKS public keys endpoint on the Next.js client (e.g. `https://wedplan-client-pearl.vercel.app/api/auth/jwks`) |
| `BETTER_AUTH_ISSUER` | Expected JWT issuer claim issued by Better Auth (e.g. `https://wedplan-client-pearl.vercel.app`) |
| `STRIPE_SECRET_KEY` | Stripe secret API key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_PRICE_ID` | Recurring Stripe Price ID for vendor Premium subscription (`price_...`) |
| `IMGBB_API_KEY` | ImgBB API key (optional server reference for image upload handling) |

---

## Required Application URLs & Production Endpoints

Configure the following environment variables in production:

- `CLIENT_URL` = `https://wedplan-client-pearl.vercel.app`
- `BETTER_AUTH_JWKS_URL` = `https://wedplan-client-pearl.vercel.app/api/auth/jwks`
- `BETTER_AUTH_ISSUER` = `https://wedplan-client-pearl.vercel.app`

### Production Endpoints
1. **Live Server Base URL**:
   `https://wedplan-server-ruddy.vercel.app`
2. **Server Health Check Endpoint**:
   `https://wedplan-server-ruddy.vercel.app/api/health`
3. **Stripe Webhook Endpoint**:
   `https://wedplan-server-ruddy.vercel.app/api/webhooks/stripe`
   - **Required Production Webhook Events (5)**:
     1. `checkout.session.completed`
     2. `invoice.paid`
     3. `invoice.payment_failed`
     4. `customer.subscription.updated`
     5. `customer.subscription.deleted`

---

## Installation & Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create a `.env` file in the root directory based on the environment variables table above.

### 3. Start Development Server
Runs with Node's native file-watcher (`node --watch`):
```bash
npm run dev
```

### 4. Start Production Server
```bash
npm start
```

---

## Stripe Local Testing Guide

### 1. Test Card Credentials
Use Stripe's standard test card on Checkout:
- **Card Number**: `4242 4242 4242 4242`
- **MM/YY**: Any date in the future (e.g. `12/28`)
- **CVC**: Any 3 digits (e.g. `123`)
- **ZIP/Postal**: Any valid ZIP (e.g. `10001`)

### 2. Forwarding Webhooks with the Stripe CLI
Use the `--events` flag to listen exclusively to the 5 required platform events:
```bash
stripe listen --forward-to localhost:5000/api/webhooks/stripe --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.updated,customer.subscription.deleted
```
Copy the printed webhook signing secret (`whsec_...`) into your `.env` file as `STRIPE_WEBHOOK_SECRET`.

### 3. Testing Webhooks Locally Without Real Payments
To test the webhook handler locally without going through the browser checkout flow, trigger events directly via the Stripe CLI:
```bash
# Trigger a test checkout completion event
stripe trigger checkout.session.completed

# Trigger a subscription renewal invoice event
stripe trigger invoice.paid
```
The local server will receive the event at `POST /api/webhooks/stripe`, verify the signature with your local `STRIPE_WEBHOOK_SECRET`, and execute the database updates.

---

## API Endpoints List

### Public Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Root server status check |
| `GET` | `/api/health` | Health status ping |
| `GET` | `/api/categories` | 6 wedding service categories |
| `GET` | `/api/services` | Service catalog with search, category filter, price filter, sorting & pagination |
| `GET` | `/api/services/featured` | 6 latest approved and active services |
| `GET` | `/api/services/:id` | Service detail with sanitized vendor profile |

### Authenticated User Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/me` | Current user profile and database-verified role |

### Customer Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/customer/stats` | Customer booking summary metrics |
| `POST` | `/api/bookings` | Submit booking request (prevents duplicate active booking & self-booking) |
| `GET` | `/api/bookings/my` | Customer's booking history with service preview & vendor details |
| `GET` | `/api/bookings/:id` | Detailed booking information (customer owner or vendor owner) |
| `PATCH` | `/api/bookings/:id/cancel` | Cancel pending booking (atomic, 409 if status changed) |

### Vendor Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/vendor/stats` | Vendor dashboard statistics (services, bookings, earnings) |
| `GET` | `/api/vendor/subscription` | Vendor subscription status, expiry, and payment history |
| `POST` | `/api/vendor/services` | Create new service (pending approval, free-plan limit enforced) |
| `GET` | `/api/vendor/services` | List all vendor's own services (newest first) |
| `GET` | `/api/vendor/services/:id` | View single own service |
| `PATCH` | `/api/vendor/services/:id` | Update editable service details |
| `PATCH` | `/api/vendor/services/:id/availability` | Toggle availability (`isActive: boolean`) |
| `DELETE` | `/api/vendor/services/:id` | Delete own service |
| `GET` | `/api/vendor/bookings` | List bookings for vendor's services |
| `PATCH` | `/api/vendor/bookings/:id/status` | Accept or reject pending booking |

### Payment & Webhook Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/payments/create-checkout-session` | Generate Stripe Checkout session for Premium upgrade |
| `GET` | `/api/payments/session-status` | Query session payment status and DB premium state |
| `POST` | `/api/payments/cancel-subscription` | Cancel subscription at period end |
| `POST` | `/api/webhooks/stripe` | Raw body endpoint verifying Stripe signature (5 events) |

### Administrator Endpoints
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/stats` | Platform overview metrics |
| `GET` | `/api/admin/users` | List users with search, role filters, and pagination |
| `GET` | `/api/admin/users/:id` | Get single user details with stats |
| `PATCH` | `/api/admin/users/:id/block` | Block user and revoke active sessions |
| `PATCH` | `/api/admin/users/:id/unblock` | Unblock user |
| `GET` | `/api/admin/services` | List all platform services with filters & pagination |
| `GET` | `/api/admin/services/:id` | Service details with full vendor information |
| `PATCH` | `/api/admin/services/:id/status` | Approve, reject, or mark service pending |
| `DELETE` | `/api/admin/services/:id` | Delete inappropriate service |
| `GET` | `/api/admin/transactions` | Platform payment transactions (strictly READ-ONLY) |
