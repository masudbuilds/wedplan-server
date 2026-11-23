# WedPlan Server

Backend REST API service for **WedPlan** — an end-to-end role-based wedding planning platform connecting couples with wedding vendors, moderated by platform administrators.

Built with **Node.js 20+**, **Express.js**, the official **MongoDB driver** (no Mongoose), and secure **Stripe Checkout** subscription webhooks.

---

## Repository Links & Live URLs

- **Live Server URL**: `https://wedplan-server.example.com` *(Placeholder: replace with your deployed server domain)*
- **Live Client URL**: `https://wedplan.example.com` *(Placeholder: replace with your deployed frontend domain)*
- **Server Repository**: `https://github.com/your-username/wedplan-server` *(Placeholder: replace with your server repo URL)*
- **Client Repository**: `https://github.com/your-username/wedplan-client` *(Placeholder: replace with your client repo URL)*

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
- **Database**: MongoDB (Official `mongodb` Node.js driver v6+)
- **Authentication**: `jose` (JWT verification with remote JWKS)
- **Payments**: Stripe Node SDK (Checkout sessions & signature-verified webhooks)
- **Security**: `helmet` security headers, strict `cors` policies, MongoDB parameterization, regex escaping

---

## Environment Variables

Copy `.env.example` to `.env` in the server root. Never commit `.env` to Git.

| Variable | Description |
|---|---|
| `PORT` | Local port number for Express server to listen on (default `5000`) |
| `MONGODB_URI` | MongoDB connection string (local or MongoDB Atlas connection URI) |
| `DB_NAME` | MongoDB database name (e.g. `wedplan`) |
| `CLIENT_URL` | Whitelisted client origin(s) for CORS (supports comma-separated list, e.g. `http://localhost:3000,https://wedplan.example.com`) |
| `BETTER_AUTH_JWKS_URL` | Remote JWKS public keys endpoint on the Next.js client (e.g. `http://localhost:3000/api/auth/jwks`) |
| `BETTER_AUTH_ISSUER` | Expected JWT issuer claim issued by Better Auth (e.g. `http://localhost:3000`) |
| `STRIPE_SECRET_KEY` | Stripe secret API key (`sk_test_...`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) |
| `STRIPE_PRICE_ID` | Recurring Stripe Price ID for vendor Premium subscription (`price_...`) |
| `IMGBB_API_KEY` | ImgBB API key (optional server reference for image upload handling) |

---

## Required Production Application URLs

When deploying WedPlan to production, configure the following URLs:

1. **Better Auth JWKS URL**:
   `https://<client-domain>/api/auth/jwks`
2. **Better Auth Issuer**:
   `https://<client-domain>`
3. **Stripe Webhook Endpoint**:
   `https://<server-domain>/api/webhooks/stripe`
   - **Required Production Webhook Events (5)**:
     1. `checkout.session.completed`
     2. `invoice.paid`
     3. `invoice.payment_failed`
     4. `customer.subscription.updated`
     5. `customer.subscription.deleted`

---

## Deployment Recommendation (Render vs. Vercel)

For hosting the WedPlan server and handling Stripe Webhooks, a **standard persistent Node.js host (such as Render or Railway) is strongly recommended** over serverless platforms (like Vercel functions):

1. **Reliable Raw Body Buffering**: Stripe webhook signature verification (`stripe.webhooks.constructEvent`) requires the exact byte-for-byte raw HTTP request payload. Standard Node.js hosts pass the unadulterated stream directly to `express.raw()`, eliminating serverless body-mangling issues.
2. **Persistent Database Connections**: A continuous Node process maintains a cached `MongoClient` connection pool, preventing connection exhaustion and eliminating cold-start latency spikes.
3. **No Webhook Timeout Drops**: Stripe requires webhook responses within 10 seconds. Serverless cold boots can cause timeouts and unnecessary webhook retries.

> **Serverless Compatibility**: If deploying to Vercel, a pre-configured `vercel.json` and `api/index.js` serverless handler are already included in this repository.

---

## Installation & Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
Create `.env` based on `.env.example`:
```bash
cp .env.example .env
```

### 3. Seed Sample Approved Services
Inserts 8 sample wedding services across all 6 categories into MongoDB. Optionally link them to an existing registered vendor:
```bash
# Seed with placeholder vendor IDs:
npm run seed

# Or link sample services to a registered vendor email:
npm run seed -- vendor@example.com
```

### 4. Create an Administrator Account
Administrators are **never** created via public registration. To promote an existing registered user to the Admin role:
```bash
npm run make-admin -- admin@example.com
```

### 5. Start Development Server
Runs with Node's native file-watcher (`node --watch`):
```bash
npm run dev
```

### 6. Start Production Server
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

---

## API Documentation

For the full specification of all public, customer, vendor, admin, and payment endpoints, see [docs/api.md](docs/api.md).
