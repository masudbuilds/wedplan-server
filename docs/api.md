# WedPlan API Documentation

This document describes all API endpoints currently implemented in the **WedPlan Server**.

---

## Base URL

Local Development: `http://localhost:5000/api`

---

## Overview of Endpoints

| Method | Endpoint | Auth Required | Description |
|---|---|---|---|
| `GET` | `/api/health` | No | Server health and operational status check |
| `GET` | `/api/categories` | No | List of 6 predefined wedding service categories |
| `GET` | `/api/services` | No | List approved & active services (search, filter, sort, paginate) |
| `GET` | `/api/services/featured` | No | Latest 6 approved & active services for home dynamic section |
| `GET` | `/api/services/:id` | No | Detailed information for a single approved & active service |
| `GET` | `/api/me` | Yes (`Bearer <token>`) | Current authenticated user's profile and role info |

---

## Public Endpoints

### 1. Health Check

Checks if the server is alive and functioning.

- **Method**: `GET`
- **Path**: `/api/health`
- **Auth**: None
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "message": "WedPlan API running"
  }
  ```

---

### 2. Service Categories

Returns the 6 wedding service categories specified in the platform requirements.

- **Method**: `GET`
- **Path**: `/api/categories`
- **Auth**: None
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "categories": [
      "Photography & Videography",
      "Wedding Venues",
      "Decoration & Florist",
      "Catering Services",
      "Makeup & Styling",
      "Wedding Fashion"
    ]
  }
  ```

---

### 3. List Services

Returns approved and active services from MongoDB. Only services with `status: "approved"` and `isActive: true` are returned.

- **Method**: `GET`
- **Path**: `/api/services`
- **Auth**: None
- **Query Parameters**:
  - `search` *(string, optional)*: Case-insensitive substring match against `serviceName`.
  - `category` *(string, optional)*: Filter by category (e.g. `Photography & Videography`).
  - `location` *(string, optional)*: Case-insensitive substring match against `location` (e.g. `New York`).
  - `sort` *(string, optional)*: Sort order: `"price_asc"` (or `"price-asc"`) for ascending price, `"price_desc"` (or `"price-desc"`) for descending price. Defaults to newest first (`createdAt: -1`).
  - `page` *(number, optional, default: `1`)*: Page number for pagination.
  - `limit` *(number, optional, default: `12`)*: Items per page (max `100`).

- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "total": 8,
    "page": 1,
    "limit": 12,
    "services": [
      {
        "id": "6741b2e3f5a8c1234567890a",
        "_id": "6741b2e3f5a8c1234567890a",
        "vendorId": "6741b2e3f5a8c12345678900",
        "serviceName": "Editorial Wedding Photo & Cinema",
        "category": "Photography & Videography",
        "description": "Full-day fine art photography, cinematic 4K highlight film, and aerial drone coverage crafted for timeless romance.",
        "price": 3200,
        "location": "New York, NY",
        "images": [
          "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80"
        ],
        "status": "approved",
        "isActive": true,
        "isAvailable": true,
        "createdAt": "2026-01-10T09:00:00.000Z",
        "vendor": {
          "name": "Julian & Co. Photography",
          "businessName": "Julian & Co. Photography",
          "image": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80",
          "isPremium": false
        },
        "vendorName": "Julian & Co. Photography",
        "vendorImage": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=200&q=80",
        "isPremium": false
      }
    ]
  }
  ```

---

### 4. Featured Services

Returns the latest 6 approved and active services for the homepage banner and dynamic sections.

- **Method**: `GET`
- **Path**: `/api/services/featured`
- **Auth**: None
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "services": [
      {
        "id": "6741b2e3f5a8c1234567890a",
        "serviceName": "Classical String Quartet & Cocktail Trio",
        "category": "Photography & Videography",
        "price": 1850,
        "location": "Philadelphia, PA",
        "images": ["..."],
        "status": "approved",
        "isActive": true,
        "vendor": {
          "name": "Serenade Acoustic Strings",
          "businessName": "Serenade Acoustic Strings",
          "image": "...",
          "isPremium": false
        }
      }
    ]
  }
  ```

---

### 5. Service Details

Returns a single service by its MongoDB ObjectId. Only approved and active services are returned.

- **Method**: `GET`
- **Path**: `/api/services/:id`
- **Auth**: None
- **URL Parameters**:
  - `id`: 24-character hexadecimal MongoDB ObjectId.
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "service": {
      "id": "6741b2e3f5a8c1234567890a",
      "serviceName": "Editorial Wedding Photo & Cinema",
      "category": "Photography & Videography",
      "description": "Full-day fine art photography, cinematic 4K highlight film...",
      "price": 3200,
      "location": "New York, NY",
      "images": ["..."],
      "status": "approved",
      "isActive": true,
      "createdAt": "2026-01-10T09:00:00.000Z",
      "vendor": {
        "name": "Julian & Co. Photography",
        "businessName": "Julian & Co. Photography",
        "image": "...",
        "isPremium": false
      }
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request` (Invalid ID format):
    ```json
    {
      "success": false,
      "message": "Invalid service ID: 123"
    }
    ```
  - `404 Not Found` (Service does not exist or is pending/rejected/inactive):
    ```json
    {
      "success": false,
      "message": "Service not found or not currently active/approved"
    }
    ```

---

## Protected Endpoints

### 6. Get Current User Profile (`/api/me`)

Verifies the user's JWT Bearer token using Better Auth's remote JWKS endpoint and loads current account status directly from MongoDB.

- **Method**: `GET`
- **Path**: `/api/me`
- **Auth**: Required (`Authorization: Bearer <jwt-token>`)
- **Success Response (200 OK)**:
  ```json
  {
    "success": true,
    "user": {
      "id": "6741b2e3f5a8c12345678999",
      "email": "vendor@wedplan.test",
      "name": "Jane Vendor",
      "role": "vendor",
      "subscriptionPlan": "free",
      "subscriptionExpiresAt": null
    }
  }
  ```
- **Error Responses**:
  - `401 Unauthorized` (Missing or malformed Authorization header):
    ```json
    {
      "success": false,
      "message": "Authorization token missing or malformed"
    }
    ```
  - `401 Unauthorized` (Expired or tampered token):
    ```json
    {
      "success": false,
      "message": "Invalid or expired token"
    }
    ```
  - `401 Unauthorized` (User deleted or nonexistent in MongoDB):
    ```json
    {
      "success": false,
      "message": "User not found in system records"
    }
    ```
  - `403 Forbidden` (User has been blocked by Admin):
    ```json
    {
      "success": false,
      "message": "Your account has been blocked. Please contact support."
    }
    ```

---

## Error Handling Standards

All errors across the API conform to the uniform JSON format:
```json
{
  "success": false,
  "message": "Descriptive error message"
}
```
HTTP status codes used:
- `200`: Success
- `400`: Bad Request (validation failure, invalid ObjectId)
- `401`: Unauthorized (missing, invalid, or expired authentication token)
- `403`: Forbidden (blocked account or insufficient role privileges)
- `404`: Not Found (resource or endpoint does not exist)
- `500`: Internal Server Error
