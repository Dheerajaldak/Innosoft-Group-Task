import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server.js';
import pool from '../db.js';
import { initDatabase } from '../initDb.js';

test('API End-to-End Test Suite', async (t) => {
  await initDatabase();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query("DELETE FROM bookings WHERE organizer_email LIKE '%@testsuite.com'");
  });

  await t.test('GET /api/rooms returns seeded rooms', async () => {
    const res = await fetch(`${baseUrl}/api/rooms`);
    assert.equal(res.status, 200);
    const rooms = await res.json();
    assert.equal(Array.isArray(rooms), true);
    assert.ok(rooms.length >= 5);
    const roomNames = rooms.map((r) => r.name);
    assert.ok(roomNames.includes('Atlas'));
  });

  let createdBookingId = null;
  const roomRes = await fetch(`${baseUrl}/api/rooms`);
  const rooms = await roomRes.json();
  const atlas = rooms.find((r) => r.name === 'Atlas');

  await t.test('POST /api/bookings creates booking successfully (201)', async () => {
    const payload = {
      roomId: atlas.id,
      title: 'Design Review',
      organizerEmail: 'dev@testsuite.com',
      attendees: 3,
      start: '2031-10-10T10:00:00.000Z',
      end: '2031-10-10T11:00:00.000Z'
    };

    const res = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.title, 'Design Review');
    assert.equal(data.status, 'confirmed');
    createdBookingId = data.id;
  });

  await t.test('POST /api/bookings returns 409 conflict for overlapping booking', async () => {
    const payload = {
      roomId: atlas.id,
      title: 'Conflicting Sync',
      organizerEmail: 'other@testsuite.com',
      attendees: 2,
      start: '2031-10-10T10:30:00.000Z',
      end: '2031-10-10T11:30:00.000Z'
    };

    const res = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 409);
    const data = await res.json();
    assert.equal(data.error.code, 'BOOKING_CONFLICT');
    assert.equal(data.error.details.conflictingBookingId, createdBookingId);
  });

  await t.test('POST /api/bookings returns 400 for invalid inputs', async () => {
    const payload = {
      roomId: atlas.id,
      title: '',
      organizerEmail: 'invalid-email',
      attendees: 0,
      start: '2031-10-10T10:00:00.000Z',
      end: '2031-10-10T09:00:00.000Z'
    };

    const res = await fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.ok(data.error);
  });

  await t.test('GET /api/bookings returns bookings for the day', async () => {
    const res = await fetch(`${baseUrl}/api/bookings?date=2031-10-10&roomId=${atlas.id}`);
    assert.equal(res.status, 200);
    const bookings = await res.json();
    assert.ok(bookings.some((b) => b.id === createdBookingId));
  });

  await t.test('GET /api/availability filters out booked room', async () => {
    const res = await fetch(
      `${baseUrl}/api/availability?date=2031-10-10&start=10:15&end=10:45&minCapacity=2`
    );
    assert.equal(res.status, 200);
    const available = await res.json();
    assert.equal(available.some((r) => r.id === atlas.id), false);
  });

  await t.test('DELETE /api/bookings/:id cancels booking', async () => {
    const res = await fetch(`${baseUrl}/api/bookings/${createdBookingId}`, {
      method: 'DELETE'
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.booking.status, 'cancelled');
  });
});
