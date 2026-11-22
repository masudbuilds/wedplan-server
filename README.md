# WedPlan Server

Backend API service for **WedPlan** — a role-based wedding planning platform connecting couples with wedding vendors and managed by platform administrators.

Built with **Node.js (Node 20+)**, **Express.js**, and the official **MongoDB driver** (no Mongoose).

---

## Technology Stack

- **Runtime**: Node.js v20+ (ES Modules)
- **Framework**: Express.js
- **Database**: MongoDB (official `mongodb` driver)
- **Authentication**: JWT token verification using `jose` with remote JWKS from Better Auth (hosted on Next.js client)
- **Payments**: Stripe Checkout Subscriptions and verified Webhook listeners
- **Security**: `helmet` security headers, strict `cors` policies, parameterized MongoDB queries, regex input escaping

---

## Architecture & Security Decisions

1. **Better Auth & Remote JWKS**: Authentication runs on the Next.js client and issues signed JWTs. The backend never validates tokens with a shared secret; it fetches public keys from Better Auth's JWKS endpoint (`/api/auth/jwks`) via `jose.createRemoteJWKSet`.
2. **Server-Side Authority**: Roles, `isBlocked` flags, and `subscriptionPlan` details are **always** fetched directly from MongoDB `users` collection. Roles or user IDs in request bodies or JWT claims are never blindly trusted.
3. **Database Collections**:
   - `users`: Managed by Better Auth.
   - `services`: Vendor wedding services (`status: "pending" | "approved" | "rejected"`, `isActive: boolean`).
   - `bookings`: Customer booking requests with partial unique index on active dates.
   - `transactions`: Stripe payment and renewal records (strictly read-only for admins).
4. **Stripe Payment Security**:
   - Premium status is activated **ONLY** by cryptographically verified Stripe webhook events (`stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`).
   - The frontend success redirect route (`/api/payments/session-status`) strictly reads from the database; it never activates subscriptions directly.
   - Idempotent recording of transactions avoids duplicate records on retried webhooks.
5. **Clean Code Style**: Simple, beginner-friendly JavaScript using async/await and plain functions. No classes or complex abstractions.

---

## Environment Variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `PORT` | Port for Express server | `5000` |
| `MONGODB_URI` | MongoDB connection URI | `mongodb://127.0.0.1:27017` |
| `DB_NAME` | MongoDB database name | `wedplan` |
| `CLIENT_URL` | Client origin for CORS | `http://localhost:3000` |
| `BETTER_AUTH_JWKS_URL` | Client Better Auth JWKS URL | `http://localhost:3000/api/auth/jwks` |
| `BETTER_AUTH_ISSUER` | Better Auth JWT issuer | `http://localhost:3000` |
| `STRIPE_SECRET_KEY` | Stripe test secret key (`sk_test_...`) | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret (`whsec_...`) | `whsec_...` |
| `STRIPE_PRICE_ID` | Stripe recurring Price ID for premium plan | `price_...` |
| `IMGBB_API_KEY` | ImgBB API key | `placeholder` |

---

## Installation & Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Seed Initial Sample Services
Inserts 8 approved and active wedding services into MongoDB. Optionally link them to an existing registered vendor:
```bash
npm run seed -- vendor@example.com
```

### 3. Promote a User to Admin
Admins cannot be created through public registration. Run this script to assign the `admin` role to an existing user:
```bash
npm run make-admin -- someone@example.com
```

### 4. Run Development Server
Runs with Node's native file watcher (`node --watch`):
```bash
npm run dev
```

### 5. Run Production Server
```bash
npm start
```

---

## Stripe Local Testing Guide

To test Stripe Checkout subscriptions and webhooks locally:

### 1. Stripe Test Card
Use Stripe's standard test card in Checkout:
- **Card Number**: `4242 4242 4242 4242`
- **MM/YY**: Any date in the future (e.g., `12/28`)
- **CVC**: Any 3 digits (e.g., `123`)
- **ZIP/Postal Code**: Any valid code (e.g., `10001`)

### 2. Forwarding Webhooks via Stripe CLI
Download the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run:
```bash
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```
The CLI will print a signing secret:
```
> Ready! Your webhook signing secret is whsec_xxxxxxxxxxxxxxxx (Save this to your .env)
```
Update `STRIPE_WEBHOOK_SECRET` in your `.env` with that `whsec_...` value.

### 3. Triggering Test Events
You can also trigger simulated events directly via CLI:
```bash
# Trigger checkout session completion
stripe trigger checkout.session.completed

# Trigger subscription payment failure
stripe trigger invoice.payment_failed
```

### 4. Production Webhook Events Checklist
When configuring your production webhook endpoint in the Stripe Dashboard, enable the following 5 events:
1. `checkout.session.completed`
2. `invoice.paid`
3. `invoice.payment_failed`
4. `customer.subscription.updated`
5. `customer.subscription.deleted`

---

## API Documentation

Complete endpoint documentation with request/response examples is available in [docs/api.md](docs/api.md).
