# WedPlan API Documentation

This document describes all API endpoints implemented in the **WedPlan Server**.

---

## Base URL

Local Development: `http://localhost:5000/api`

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

## Detailed Admin Endpoints Documentation

### 1. Platform Statistics

#### `GET /api/admin/stats`
- **Role**: `admin`
- **Headers**: `Authorization: Bearer <token>`
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "stats": {
      "totalUsers": 24,
      "totalVendors": 6,
      "totalCustomers": 17,
      "totalServices": 12,
      "pendingServices": 3,
      "totalTransactions": 5
    }
  }
  ```

---

### 2. User Management

#### `GET /api/admin/users`
Lists registered platform users with search, role filtering, and pagination.
- **Role**: `admin`
- **Query Parameters**:
  - `search` *(string, optional)*: Case-insensitive search on name or email.
  - `role` *(string, optional)*: Filter by `customer`, `vendor`, or `admin`.
  - `page` *(number, optional, default: 1)*: Page number.
  - `limit` *(number, optional, default: 10, max: 50)*: Items per page.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "total": 1,
    "page": 1,
    "limit": 10,
    "users": [
      {
        "id": "6741b2e3f5a8c12345678901",
        "name": "Julian Photography",
        "email": "julian@wedplan.test",
        "image": "https://...",
        "role": "vendor",
        "isBlocked": false,
        "businessName": "Julian & Co.",
        "subscriptionPlan": "premium",
        "subscriptionExpiresAt": "2027-01-01T00:00:00.000Z",
        "createdAt": "2026-01-10T09:00:00.000Z"
      }
    ]
  }
  ```

#### `GET /api/admin/users/:id`
Returns safe user profile plus activity statistics (`serviceCount` for vendors, `bookingCount` for customers).
- **Role**: `admin`
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "user": {
      "id": "6741b2e3f5a8c12345678901",
      "name": "Julian Photography",
      "email": "julian@wedplan.test",
      "role": "vendor",
      "isBlocked": false,
      "businessName": "Julian & Co.",
      "subscriptionPlan": "premium",
      "serviceCount": 4,
      "bookingCount": 0
    }
  }
  ```
- **Error Response (404 Not Found)**:
  ```json
  {
    "success": false,
    "message": "User not found: 6741b2e3f5a8c12345678999"
  }
  ```

#### `PATCH /api/admin/users/:id/block`
Blocks a user account and deletes all active sessions from the Better Auth `sessions` collection.
- **Role**: `admin`
- **Security Protections**:
  - Admin cannot block their own account (`403 Forbidden`).
  - Admin cannot block another admin account (`403 Forbidden`).
  - Cannot block an already-blocked user (`409 Conflict`).
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "User \"John Doe\" has been blocked successfully.",
    "user": {
      "id": "6741b2e3f5a8c12345678902",
      "isBlocked": true
    }
  }
  ```

#### `PATCH /api/admin/users/:id/unblock`
Restores access to a previously blocked user account.
- **Role**: `admin`
- **Error (409 Conflict)**: Returned if the user is not currently blocked.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "User \"John Doe\" has been unblocked successfully.",
    "user": {
      "id": "6741b2e3f5a8c12345678902",
      "isBlocked": false
    }
  }
  ```

---

### 3. Service Moderation

#### `GET /api/admin/services`
Lists all wedding services submitted to the platform.
- **Role**: `admin`
- **Query Parameters**:
  - `search` *(string, optional)*: Case-insensitive search on `serviceName`.
  - `status` *(string, optional)*: Filter by `pending`, `approved`, or `rejected`.
  - `category` *(string, optional)*: Filter by category.
  - `page` *(number, optional, default: 1)*
  - `limit` *(number, optional, default: 10, max: 50)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "total": 12,
    "page": 1,
    "limit": 10,
    "services": [
      {
        "id": "6741b2e3f5a8c1234567890a",
        "serviceName": "Grand Ballroom Wedding Reception",
        "category": "Wedding Venues",
        "price": 6000,
        "location": "New York, NY",
        "status": "pending",
        "isActive": true,
        "createdAt": "2026-11-22T18:00:00.000Z",
        "vendor": {
          "name": "Jane Vendor",
          "email": "jane@wedplan.test",
          "businessName": "Rosewood Estates",
          "image": "https://..."
        }
      }
    ]
  }
  ```

#### `GET /api/admin/services/:id`
Returns full service details including vendor email and metadata.
- **Role**: `admin`

#### `PATCH /api/admin/services/:id/status`
Approves, rejects, or places a service back to pending.
- **Role**: `admin`
- **Request Body**:
  ```json
  {
    "status": "approved"
  }
  ```
  *(Allowed values: `"approved"`, `"rejected"`, `"pending"`)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Service status updated to \"approved\" successfully.",
    "service": {
      "id": "6741b2e3f5a8c1234567890a",
      "status": "approved"
    }
  }
  ```
- **Error (409 Conflict)**:
  ```json
  {
    "success": false,
    "message": "Service status is already \"approved\"."
  }
  ```

#### `DELETE /api/admin/services/:id`
Deletes an inappropriate service permanently. Existing customer bookings are kept intact with a "Service no longer available" label.
- **Role**: `admin`
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Service \"Inappropriate Listing\" has been deleted successfully."
  }
  ```

---

### 4. Transactions (Strictly Read-Only)

#### `GET /api/admin/transactions`
Lists platform payments recorded via Stripe Checkout.
> **Security Guarantee**: Platform transactions are strictly read-only. No mutation routes (`POST`, `PUT`, `PATCH`, `DELETE`) exist to prevent manual manipulation of payment records.

- **Role**: `admin`
- **Query Parameters**:
  - `status` *(string, optional)*: Filter by `pending`, `completed`, or `failed`.
  - `page` *(number, optional, default: 1)*
  - `limit` *(number, optional, default: 10, max: 50)*
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "total": 3,
    "page": 1,
    "limit": 10,
    "transactions": [
      {
        "id": "6741b2e3f5a8c12345678950",
        "vendorId": "user_vendor_123",
        "plan": "premium",
        "amount": 2900,
        "currency": "usd",
        "stripeSessionId": "cs_test_a1b2c3d4",
        "stripeSubscriptionId": "sub_12345",
        "status": "completed",
        "createdAt": "2026-11-22T12:00:00.000Z",
        "vendor": {
          "name": "Jane Vendor",
          "businessName": "Rosewood Estates",
          "email": "jane@wedplan.test"
        }
      }
    ]
  }
  ```

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
- `400`: Bad Request (invalid input, malformed ObjectId)
- `401`: Unauthorized (missing, invalid, or expired JWT token, user not found)
- `403`: Forbidden (insufficient role privileges, blocked account, attempting self-block or admin-block)
- `404`: Not Found (resource does not exist)
- `409`: Conflict (attempting to set already existing state or duplicate active booking)
- `500`: Internal Server Error
