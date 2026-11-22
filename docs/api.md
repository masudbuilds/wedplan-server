# WedPlan API Documentation

This document describes all API endpoints currently implemented in the **WedPlan Server**.

---

## Base URL

Local Development: `http://localhost:5000/api`

---

## Authentication & Authorization Architecture

- Authentication is handled via Bearer JWT tokens in the `Authorization` header: `Authorization: Bearer <token>`.
- JWT tokens are verified against Better Auth's remote JWKS endpoint using `jose.createRemoteJWKSet`.
- Verified user record is loaded directly from the MongoDB `users` collection.
- Roles (`customer`, `vendor`, `admin`), `isBlocked` flags, and subscription details are strictly determined by MongoDB, never trusted from the client payload.
- All IDs (`vendorId`, `customerId`) are uniformly referenced as strings for cross-adapter compatibility.

---

## Overview of Endpoints

### Public Endpoints
| Method | Endpoint | Role | Description |
|---|---|---|---|
| `GET` | `/api/health` | Public | Server health status |
| `GET` | `/api/categories` | Public | 6 wedding service categories |
| `GET` | `/api/services` | Public | List approved & active services (search, filter, sort, paginate) |
| `GET` | `/api/services/featured` | Public | 6 latest approved & active services |
| `GET` | `/api/services/:id` | Public | Single approved & active service with vendor info |

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

---

## Detailed Endpoint Documentation

### 1. Vendor Services

#### `POST /api/vendor/services`
Creates a new service in `status: "pending"` with `isActive: true`.
- **Role**: `vendor`
- **Headers**: `Authorization: Bearer <token>`
- **Request Body**:
  ```json
  {
    "serviceName": "Sunset Seaside Wedding Photography",
    "category": "Photography & Videography",
    "description": "Full coverage of your special day with drone shots and edited digital gallery.",
    "price": 2500,
    "location": "Miami, FL",
    "images": [
      "https://images.unsplash.com/photo-1519741497674-611481863552"
    ]
  }
  ```
- **Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Service created successfully and is pending admin approval.",
    "service": {
      "id": "6741b2e3f5a8c1234567890a",
      "vendorId": "user_vendor_123",
      "serviceName": "Sunset Seaside Wedding Photography",
      "category": "Photography & Videography",
      "description": "Full coverage of your special day...",
      "price": 2500,
      "location": "Miami, FL",
      "images": ["https://..."],
      "status": "pending",
      "isActive": true,
      "createdAt": "2026-11-22T18:00:00.000Z"
    }
  }
  ```
- **Error (403 Forbidden - Free Plan Limit)**:
  ```json
  {
    "success": false,
    "message": "Free plan allows a maximum of 3 active services. Please upgrade to Premium to publish unlimited services."
  }
  ```

#### `GET /api/vendor/services`
Returns all services owned by the vendor (all statuses: `pending`, `approved`, `rejected`), sorted newest first.
- **Role**: `vendor`
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "count": 3,
    "services": [ ... ]
  }
  ```

#### `GET /api/vendor/services/:id`
Returns single service details for the owning vendor.
- **Role**: `vendor`
- **Errors**: `400` (invalid ObjectId), `404` (not found), `403` (belongs to another vendor).

#### `PATCH /api/vendor/services/:id`
Updates editable fields (`serviceName`, `category`, `description`, `price`, `location`, `images`).
- **Role**: `vendor`
- **Request Body**: (any combination of editable fields)
  ```json
  {
    "price": 2800,
    "description": "Updated package details with aerial coverage included."
  }
  ```
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Service updated successfully",
    "service": { ... }
  }
  ```

#### `PATCH /api/vendor/services/:id/availability`
Toggles `isActive` flag.
- **Role**: `vendor`
- **Request Body**:
  ```json
  {
    "isActive": false
  }
  ```
- **Rules**: Turning ON enforces free plan limit (max 3 active services) and rejects activating rejected services (`400`).

#### `DELETE /api/vendor/services/:id`
Permanently deletes a service owned by the vendor.
- **Role**: `vendor`
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Service deleted successfully"
  }
  ```

---

### 2. Customer Bookings

#### `POST /api/bookings`
Submits a booking request for an approved and active service.
- **Role**: `customer`
- **Request Body**:
  ```json
  {
    "serviceId": "6741b2e3f5a8c1234567890a",
    "eventDate": "2026-12-15",
    "eventLocation": "The Plaza Hotel, New York, NY",
    "message": "We would love to reserve our date for 150 guests."
  }
  ```
- **Success (201 Created)**:
  ```json
  {
    "success": true,
    "message": "Booking request submitted successfully.",
    "booking": {
      "id": "6741b2e3f5a8c12345678999",
      "serviceId": "6741b2e3f5a8c1234567890a",
      "serviceName": "Editorial Wedding Photo & Cinema",
      "vendorId": "vendor_user_123",
      "customerId": "customer_user_456",
      "eventDate": "2026-12-15",
      "eventLocation": "The Plaza Hotel, New York, NY",
      "message": "We would love to reserve...",
      "status": "pending",
      "createdAt": "2026-11-22T18:00:00.000Z"
    }
  }
  ```
- **Error (409 Conflict - Duplicate Booking)**:
  ```json
  {
    "success": false,
    "message": "You already have an active booking (pending) for this service on 2026-12-15."
  }
  ```

#### `GET /api/bookings/my`
Returns logged-in customer's booking list with service preview and vendor details (excluding vendor email).
- **Role**: `customer`
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "count": 1,
    "bookings": [
      {
        "id": "6741b2e3f5a8c12345678999",
        "serviceId": "6741b2e3f5a8c1234567890a",
        "serviceName": "Editorial Wedding Photo & Cinema",
        "serviceImage": "https://images.unsplash.com/photo-1519741497674-611481863552",
        "eventDate": "2026-12-15",
        "eventLocation": "The Plaza Hotel, New York, NY",
        "status": "pending",
        "vendor": {
          "name": "Julian & Co. Photography",
          "businessName": "Julian & Co. Photography",
          "image": "https://..."
        }
      }
    ]
  }
  ```

#### `GET /api/bookings/:id`
Returns booking details. Accessible only to the customer who submitted it or the vendor who received it.
- **Role**: `customer` (owner) or `vendor` (recipient)
- **Errors**: `403 Forbidden` if user is neither the customer nor the vendor.

#### `PATCH /api/bookings/:id/cancel`
Cancels a pending booking.
- **Role**: `customer` (owner)
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Booking request cancelled successfully."
  }
  ```
- **Error (409 Conflict)**:
  ```json
  {
    "success": false,
    "message": "Booking cannot be cancelled because it is already accepted."
  }
  ```

---

### 3. Vendor Bookings

#### `GET /api/vendor/bookings`
Returns bookings for vendor's services with customer contact details and service name/image.
- **Role**: `vendor`
- **Query Parameters**:
  - `status` *(optional)*: Filter by `pending`, `accepted`, `rejected`, or `cancelled`.
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "count": 2,
    "bookings": [
      {
        "id": "6741b2e3f5a8c12345678999",
        "serviceName": "Editorial Wedding Photo & Cinema",
        "eventDate": "2026-12-15",
        "eventLocation": "The Plaza Hotel, New York, NY",
        "status": "pending",
        "customer": {
          "name": "Sarah Connor",
          "email": "sarah@example.com",
          "image": "https://..."
        }
      }
    ]
  }
  ```

#### `PATCH /api/vendor/bookings/:id/status`
Accepts or rejects a pending booking.
- **Role**: `vendor`
- **Request Body**:
  ```json
  {
    "status": "accepted"
  }
  ```
  *(or `"status": "rejected"`)*
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "message": "Booking request marked as accepted successfully."
  }
  ```
- **Error (409 Conflict)**:
  ```json
  {
    "success": false,
    "message": "Booking request cannot be modified because its current status is already accepted."
  }
  ```

---

### 4. Dashboard Statistics

#### `GET /api/vendor/stats`
- **Role**: `vendor`
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "stats": {
      "totalServices": 4,
      "activeServices": 3,
      "pendingBookings": 2,
      "acceptedBookings": 5,
      "subscriptionPlan": "free",
      "isPremium": false,
      "subscriptionExpiresAt": null
    }
  }
  ```

#### `GET /api/customer/stats`
- **Role**: `customer`
- **Success (200 OK)**:
  ```json
  {
    "success": true,
    "stats": {
      "totalBookings": 4,
      "pending": 1,
      "accepted": 2,
      "rejected": 0,
      "cancelled": 1
    }
  }
  ```

---

## Universal Error Response Format

All error responses across all endpoints adhere to:
```json
{
  "success": false,
  "message": "Descriptive error message"
}
```
HTTP status codes used:
- `400`: Bad Request (invalid parameter, invalid ObjectId, or validation failure)
- `401`: Unauthorized (missing, invalid, or expired JWT token)
- `403`: Forbidden (insufficient role privileges, blocked account, or ownership violation)
- `404`: Not Found (resource does not exist)
- `409`: Conflict (duplicate active booking or invalid state transition)
- `500`: Internal Server Error
