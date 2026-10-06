# Meeting Room Booking System

A full-stack meeting room booking application built with Node.js, Express, PostgreSQL, and React (Vite). All times are handled strictly in UTC across API, database, and user interface.

---

# start command

npm run dev for both backend and frontend first install the dependencies for backend and frontend using npm install after that run npm run dev in both backend and frontend

- **API Integration Tests (`tests/api.test.js`)**:
  - `GET /api/rooms` returns seeded rooms.
  - `POST /api/bookings` successful creation with status 201.
  - `POST /api/bookings` 409 conflict detection.
  - `POST /api/bookings` 400 validation error handling.
  - `GET /api/bookings?date=YYYY-MM-DD` day view retrieval.
  - `GET /api/availability` filtering free rooms.
  - `DELETE /api/bookings/:id` cancellation flow.
- **Concurrency Test (`tests/concurrency.test.js`)**:
  - Dispatches simultaneous overlapping requests via `Promise.all` targeting the same room. Asserts that exactly one transaction succeeds with 201 while the conflicting transaction receives 409 `BOOKING_CONFLICT`.

---
