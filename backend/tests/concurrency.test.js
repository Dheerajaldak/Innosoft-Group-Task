import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from '../server.js';
import pool from '../db.js';
import { initDatabase } from '../initDb.js';

test('Concurrency Test: Simultaneous conflicting bookings assert exactly one succeeds', async (t) => {
  await initDatabase();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await pool.query("DELETE FROM bookings WHERE organizer_email LIKE '%@concurrencytest.com'");
  });

  const roomRes = await fetch(`${baseUrl}/api/rooms`);
  const rooms = await roomRes.json();
  const targetRoom = rooms[0];

  const payload1 = {
    roomId: targetRoom.id,
    title: 'Concurrent Booking Alpha',
    organizerEmail: 'alice@concurrencytest.com',
    attendees: 2,
    start: '2033-01-15T14:00:00.000Z',
    end: '2033-01-15T15:00:00.000Z'
  };

  const payload2 = {
    roomId: targetRoom.id,
    title: 'Concurrent Booking Beta',
    organizerEmail: 'bob@concurrencytest.com',
    attendees: 2,
    start: '2033-01-15T14:30:00.000Z',
    end: '2033-01-15T15:30:00.000Z'
  };

  const [res1, res2] = await Promise.all([
    fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload1)
    }),
    fetch(`${baseUrl}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload2)
    })
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [201, 409]);

  const successRes = res1.status === 201 ? res1 : res2;
  const failRes = res1.status === 409 ? res1 : res2;

  const successData = await successRes.json();
  const failData = await failRes.json();

  assert.equal(successData.status, 'confirmed');
  assert.equal(failData.error.code, 'BOOKING_CONFLICT');
  assert.equal(failData.error.details.conflictingBookingId, successData.id);

  const dbCheck = await pool.query(
    "SELECT id FROM bookings WHERE room_id = $1 AND start_time >= '2033-01-15T14:00:00.000Z' AND end_time <= '2033-01-15T15:30:00.000Z' AND status = 'confirmed'",
    [targetRoom.id]
  );
  assert.equal(dbCheck.rows.length, 1);
});
