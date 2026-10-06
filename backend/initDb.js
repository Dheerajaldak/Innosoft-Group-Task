import pool from './db.js';

export async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS rooms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        capacity INT NOT NULL,
        floor INT NOT NULL,
        amenities JSONB NOT NULL DEFAULT '[]'::jsonb
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id SERIAL PRIMARY KEY,
        room_id INT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        title VARCHAR(100) NOT NULL,
        organizer_email VARCHAR(255) NOT NULL,
        attendees INT NOT NULL,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'confirmed',
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_room_time ON bookings (room_id, start_time, end_time);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_organizer_date ON bookings (organizer_email, start_time);
    `);

    const seedRooms = [
      { name: 'Atlas', capacity: 4, floor: 1, amenities: ['monitor'] },
      { name: 'Borealis', capacity: 8, floor: 1, amenities: ['projector', 'whiteboard'] },
      { name: 'Cascade', capacity: 12, floor: 2, amenities: ['projector', 'video-conferencing'] },
      { name: 'Delta', capacity: 20, floor: 3, amenities: ['projector', 'video-conferencing', 'whiteboard'] },
      { name: 'Ember', capacity: 2, floor: 2, amenities: [] }
    ];

    for (const room of seedRooms) {
      await client.query(
        `
        INSERT INTO rooms (name, capacity, floor, amenities)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (name) DO UPDATE
        SET capacity = EXCLUDED.capacity,
            floor = EXCLUDED.floor,
            amenities = EXCLUDED.amenities;
        `,
        [room.name, room.capacity, room.floor, JSON.stringify(room.amenities)]
      );
    }
  } finally {
    client.release();
  }
}

if (process.argv[1] && process.argv[1].endsWith('initDb.js')) {
  initDatabase()
    .then(() => {
      console.log('Database initialized successfully.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Database initialization failed:', err);
      process.exit(1);
    });
}
