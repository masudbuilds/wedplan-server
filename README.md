# WedPlan Server

Backend API service for **WedPlan** — a role-based wedding planning platform connecting couples with wedding vendors and managed by platform administrators.

Built with **Node.js (Node 20+)**, **Express.js**, and the official **MongoDB driver** (no Mongoose).

---

## Technology Stack

- **Runtime**: Node.js v20+ (ES Modules)
- **Framework**: Express.js
- **Database**: MongoDB (official `mongodb` driver)
- **Authentication**: JWT token verification using `jose` with remote JWKS from Better Auth (hosted on Next.js client)
- **Security**: `helmet` security headers, strict `cors` policies, parameterized MongoDB queries, regex input escaping
- **Payments**: Stripe Checkout & Webhook verification (configured for future endpoints)

---

## Architecture & Security Decisions

1. **Better Auth & Remote JWKS**: Authentication runs on the Next.js client and issues signed JWTs. The backend never validates tokens with a shared secret; it fetches public keys from Better Auth's JWKS endpoint (`/api/auth/jwks`) via `jose.createRemoteJWKSet`.
2. **Server-Side Authority**: Roles, `isBlocked` flags, and `subscriptionPlan` details are **always** fetched directly from MongoDB `users` collection. Roles or user IDs in request bodies or JWT claims are never blindly trusted.
3. **Database Collections**:
   - `users`: Managed by Better Auth.
   - `services`: Vendor wedding services (`status: "pending" | "approved" | "rejected"`, `isActive: boolean`).
   - `bookings`: Customer booking requests.
   - `transactions`: Stripe checkout records.
4. **Clean Code Style**: Simple, beginner-friendly JavaScript using async/await and plain functions. No unnecessary class hierarchies or complex abstractions.

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
| `STRIPE_SECRET_KEY` | Stripe test secret key | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `STRIPE_PRICE_ID` | Stripe price ID for premium subscription | `price_...` |
| `IMGBB_API_KEY` | ImgBB API key | `placeholder` |

---

## Installation & Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Seed Initial Sample Services
Inserts 8 approved and active wedding services into MongoDB:
```bash
npm run seed
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

## API Documentation

Complete endpoint documentation with request/response examples is available in [docs/api.md](docs/api.md).

### Quick Endpoint Reference
- `GET /api/health` — Health check
- `GET /api/categories` — 6 wedding service categories
- `GET /api/services` — Approved and active services (search, filter, sort, paginate)
- `GET /api/services/featured` — 6 latest approved and active services
- `GET /api/services/:id` — Service details by ObjectId
- `GET /api/me` — Authenticated user profile (protected)
