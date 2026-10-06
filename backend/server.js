import express from 'express';
import cors from 'cors';
import pool from './db.js';
import {
  validateTimeWindow,
  validateBookingFields,
  checkRoomCapacity
} from './rules.js';

export const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

function formatRoom(row) {
  return {
    id: row.id,
    name: row.name,
    capacity: row.capacity,
    floor: row.floor,
    amenities: Array.isArray(row.amenities) ? row.amenities : []
  };
}

function formatBooking(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    roomName: row.room_name,
    title: row.title,
    organizerEmail: row.organizer_email,
    attendees: row.attendees,
    start: new Date(row.start_time).toISOString(),
    end: new Date(row.end_time).toISOString(),
    status: row.status,
    createdAt: new Date(row.created_at).toISOString()
  };
}

app.get('/api/rooms', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rooms ORDER BY id ASC');
    res.json(result.rows.map(formatRoom));
  } catch (err) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

app.get('/api/bookings', async (req, res) => {
  try {
    const { date, roomId } = req.query;

    const queryParts = [
      'SELECT b.*, r.name as room_name FROM bookings b',
      'JOIN rooms r ON b.room_id = r.id',
      "WHERE b.status = 'confirmed'"
    ];
    const values = [];

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'date query parameter must be in YYYY-MM-DD format.'
          }
        });
      }
      const dayStart = new Date(`${date}T00:00:00.000Z`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      values.push(dayStart.toISOString());
      queryParts.push(`AND b.start_time >= $${values.length}`);
      values.push(dayEnd.toISOString());
      queryParts.push(`AND b.start_time < $${values.length}`);
    }

    if (roomId) {
      values.push(roomId);
      queryParts.push(`AND b.room_id = $${values.length}`);
    }

    queryParts.push('ORDER BY b.start_time ASC, b.id ASC');

    const result = await pool.query(queryParts.join(' '), values);
    res.json(result.rows.map(formatBooking));
  } catch (err) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

app.post('/api/bookings', async (req, res) => {
  const { roomId, title, organizerEmail, attendees, start, end } = req.body;

  const fieldValidation = validateBookingFields({ roomId, title, organizerEmail, attendees });
  if (!fieldValidation.valid) {
    return res.status(400).json({
      error: {
        code: fieldValidation.code,
        message: fieldValidation.message
      }
    });
  }

  const timeValidation = validateTimeWindow(start, end, new Date());
  if (!timeValidation.valid) {
    return res.status(400).json({
      error: {
        code: timeValidation.code,
        message: timeValidation.message
      }
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roomResult = await client.query(
      'SELECT id, name, capacity, floor, amenities FROM rooms WHERE id = $1 FOR UPDATE',
      [roomId]
    );

    if (roomResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: {
          code: 'ROOM_NOT_FOUND',
          message: 'Room not found.'
        }
      });
    }

    const room = roomResult.rows[0];

    const capacityValidation = checkRoomCapacity(attendees, room.capacity);
    if (!capacityValidation.valid) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: {
          code: capacityValidation.code,
          message: capacityValidation.message
        }
      });
    }

    const startUtc = timeValidation.start;
    const endUtc = timeValidation.end;
    const dateStr = startUtc.toISOString().slice(0, 10);
    const dayStart = new Date(`${dateStr}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const countResult = await client.query(
      `
      SELECT COUNT(*) AS count FROM bookings
      WHERE LOWER(organizer_email) = LOWER($1)
        AND status = 'confirmed'
        AND start_time >= $2
        AND start_time < $3
      `,
      [organizerEmail.trim(), dayStart.toISOString(), dayEnd.toISOString()]
    );

    if (parseInt(countResult.rows[0].count, 10) >= 3) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: {
          code: 'ORGANIZER_LIMIT_EXCEEDED',
          message: 'An organizer cannot hold more than 3 confirmed bookings that start on the same day.'
        }
      });
    }

    const overlapResult = await client.query(
      `
      SELECT id, room_id, title, organizer_email, attendees, start_time, end_time, status
      FROM bookings
      WHERE room_id = $1
        AND status = 'confirmed'
        AND start_time < $3
        AND end_time > $2
      LIMIT 1
      `,
      [roomId, startUtc.toISOString(), endUtc.toISOString()]
    );

    if (overlapResult.rows.length > 0) {
      await client.query('ROLLBACK');
      const conflict = overlapResult.rows[0];
      const confStart = new Date(conflict.start_time).toISOString().slice(11, 16);
      const confEnd = new Date(conflict.end_time).toISOString().slice(11, 16);
      return res.status(409).json({
        error: {
          code: 'BOOKING_CONFLICT',
          message: `Room ${room.name} is already booked from ${confStart} to ${confEnd} UTC.`,
          details: {
            conflictingBookingId: conflict.id
          }
        }
      });
    }

    const insertResult = await client.query(
      `
      INSERT INTO bookings (room_id, title, organizer_email, attendees, start_time, end_time, status)
      VALUES ($1, $2, $3, $4, $5, $6, 'confirmed')
      RETURNING id, room_id, title, organizer_email, attendees, start_time, end_time, status, created_at
      `,
      [
        roomId,
        title.trim(),
        organizerEmail.trim().toLowerCase(),
        attendees,
        startUtc.toISOString(),
        endUtc.toISOString()
      ]
    );

    await client.query('COMMIT');
    const newBooking = { ...insertResult.rows[0], room_name: room.name };
    res.status(201).json(formatBooking(newBooking));
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  } finally {
    client.release();
  }
});

app.delete('/api/bookings/:id', async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    return res.status(400).json({
      error: {
        code: 'INVALID_INPUT',
        message: 'Invalid booking id.'
      }
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query(
      `
      SELECT b.*, r.name as room_name FROM bookings b
      JOIN rooms r ON b.room_id = r.id
      WHERE b.id = $1
      FOR UPDATE
      `,
      [id]
    );

    if (result.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: {
          code: 'BOOKING_NOT_FOUND',
          message: 'Booking not found.'
        }
      });
    }

    const booking = result.rows[0];

    if (booking.status === 'cancelled') {
      await client.query('COMMIT');
      return res.status(200).json({
        message: 'Booking is already cancelled.',
        booking: formatBooking(booking)
      });
    }

    if (new Date(booking.start_time).getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: {
          code: 'CANNOT_CANCEL_STARTED',
          message: 'A booking that has already started cannot be cancelled.'
        }
      });
    }

    const updateResult = await client.query(
      `
      UPDATE bookings
      SET status = 'cancelled'
      WHERE id = $1
      RETURNING id, room_id, title, organizer_email, attendees, start_time, end_time, status, created_at
      `,
      [id]
    );

    await client.query('COMMIT');
    const updated = { ...updateResult.rows[0], room_name: booking.room_name };
    res.status(200).json({
      message: 'Booking cancelled successfully.',
      booking: formatBooking(updated)
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  } finally {
    client.release();
  }
});

app.get('/api/availability', async (req, res) => {
  try {
    const { date, start, end, minCapacity } = req.query;

    if (!date || !start || !end) {
      return res.status(400).json({
        error: {
          code: 'INVALID_INPUT',
          message: 'date, start, and end query parameters are required.'
        }
      });
    }

    const startIso = `${date}T${start}:00.000Z`;
    const endIso = `${date}T${end}:00.000Z`;

    const timeValidation = validateTimeWindow(startIso, endIso, null);
    if (!timeValidation.valid) {
      return res.status(400).json({
        error: {
          code: timeValidation.code,
          message: timeValidation.message
        }
      });
    }

    const capacityThreshold = parseInt(minCapacity, 10) || 1;

    const result = await pool.query(
      `
      SELECT r.* FROM rooms r
      WHERE r.capacity >= $1
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b.room_id = r.id
            AND b.status = 'confirmed'
            AND b.start_time < $3
            AND b.end_time > $2
        )
      ORDER BY r.capacity ASC, r.id ASC
      `,
      [capacityThreshold, timeValidation.start.toISOString(), timeValidation.end.toISOString()]
    );

    res.json(result.rows.map(formatRoom));
  } catch (err) {
    res.status(500).json({ error: { code: 'SERVER_ERROR', message: err.message } });
  }
});

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}
