import { useState, useEffect, useCallback } from 'react';
import './App.css';

const TIME_SLOTS = [];
for (let h = 8; h <= 20; h++) {
  for (let m = 0; m < 60; m += 15) {
    if (h === 20 && m > 0) continue;
    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    TIME_SLOTS.push(`${hh}:${mm}`);
  }
}

const START_SLOTS = TIME_SLOTS.slice(0, -1);
const END_SLOTS = TIME_SLOTS.slice(1);

function getTodayUtcString() {
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function App() {
  const [rooms, setRooms] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [selectedDate, setSelectedDate] = useState(getTodayUtcString());
  const [bookings, setBookings] = useState([]);
  const [loadingBookings, setLoadingBookings] = useState(false);
  const [globalMessage, setGlobalMessage] = useState('');

  const [formRoomId, setFormRoomId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formAttendees, setFormAttendees] = useState(1);
  const [formDate, setFormDate] = useState(getTodayUtcString());
  const [formStart, setFormStart] = useState('09:00');
  const [formEnd, setFormEnd] = useState('10:00');
  const [formClientError, setFormClientError] = useState('');
  const [formServerError, setFormServerError] = useState('');
  const [formSubmitting, setFormSubmitting] = useState(false);

  const [confirmCancelId, setConfirmCancelId] = useState(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  const [searchDate, setSearchDate] = useState(getTodayUtcString());
  const [searchStart, setSearchStart] = useState('09:00');
  const [searchEnd, setSearchEnd] = useState('10:00');
  const [searchMinCapacity, setSearchMinCapacity] = useState(1);
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');


  const fetchBookings = useCallback(async (date) => {
    setLoadingBookings(true);
    try {
      const res = await fetch(`http://localhost:5000/api/bookings?date=${date}`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setBookings(data);
      }
    } catch {
      setGlobalMessage('Failed to load bookings for selected day.');
    } finally {
      setLoadingBookings(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    const loadInitialRooms = async () => {
      try {
        const res = await fetch('http://localhost:5000/api/rooms');
        const data = await res.json();
        if (!ignore && Array.isArray(data)) {
          setRooms(data);
          setFormRoomId((prev) => (prev ? prev : (data[0]?.id ?? '')));
        }
      } catch {
        if (!ignore) {
          setGlobalMessage('Failed to load meeting rooms from server.');
        }
      } finally {
        if (!ignore) {
          setLoadingRooms(false);
        }
      }
    };
    loadInitialRooms();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedDate) return;
    let ignore = false;
    const loadDayBookings = async () => {
      setLoadingBookings(true);
      try {
        const res = await fetch(`http://localhost:5000/api/bookings?date=${selectedDate}`);
        const data = await res.json();
        if (!ignore && Array.isArray(data)) {
          setBookings(data);
        }
      } catch {
        if (!ignore) {
          setGlobalMessage('Failed to load bookings for selected day.');
        }
      } finally {
        if (!ignore) {
          setLoadingBookings(false);
        }
      }
    };
    loadDayBookings();
    return () => {
      ignore = true;
    };
  }, [selectedDate]);

  const handleCreateBooking = async (e) => {
    e.preventDefault();
    setFormClientError('');
    setFormServerError('');
    setGlobalMessage('');

    if (!formRoomId) {
      setFormClientError('Please select a room.');
      return;
    }

    if (!formTitle.trim()) {
      setFormClientError('Title is required.');
      return;
    }

    if (formTitle.trim().length > 100) {
      setFormClientError('Title must be under 100 characters.');
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formEmail.trim())) {
      setFormClientError('Please enter a valid email address.');
      return;
    }

    const attendeesNum = parseInt(formAttendees, 10);
    if (isNaN(attendeesNum) || attendeesNum < 1) {
      setFormClientError('Attendees must be at least 1.');
      return;
    }

    const selectedRoom = rooms.find((r) => String(r.id) === String(formRoomId));
    if (selectedRoom && attendeesNum > selectedRoom.capacity) {
      setFormClientError(`Attendees (${attendeesNum}) exceed capacity (${selectedRoom.capacity}) for ${selectedRoom.name}.`);
      return;
    }

    if (formEnd <= formStart) {
      setFormClientError('End time must be after start time.');
      return;
    }

    const startMinutes = parseInt(formStart.slice(0, 2), 10) * 60 + parseInt(formStart.slice(3, 5), 10);
    const endMinutes = parseInt(formEnd.slice(0, 2), 10) * 60 + parseInt(formEnd.slice(3, 5), 10);
    const durationMinutes = endMinutes - startMinutes;

    if (durationMinutes < 15) {
      setFormClientError('Booking duration must be at least 15 minutes.');
      return;
    }

    if (durationMinutes > 240) {
      setFormClientError('Booking duration cannot exceed 4 hours.');
      return;
    }

    const startIso = `${formDate}T${formStart}:00.000Z`;
    const endIso = `${formDate}T${formEnd}:00.000Z`;

    if (new Date(startIso).getTime() < Date.now()) {
      setFormClientError('Booking cannot start in the past.');
      return;
    }

    setFormSubmitting(true);
    try {
      const res = await fetch('http://localhost:5000/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: Number(formRoomId),
          title: formTitle.trim(),
          organizerEmail: formEmail.trim(),
          attendees: attendeesNum,
          start: startIso,
          end: endIso
        })
      });

      const data = await res.json();
      if (!res.ok) {
        setFormServerError(data.error?.message || 'Failed to create booking.');
      } else {
        setFormTitle('');
        setGlobalMessage(`Booking "${data.title}" successfully confirmed.`);
        if (selectedDate === formDate) {
          fetchBookings(selectedDate);
        } else {
          setSelectedDate(formDate);
        }
      }
    } catch {
      setFormServerError('Network error while creating booking.');
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleCancelBooking = async (id) => {
    setCancelLoading(true);
    setGlobalMessage('');
    try {
      const res = await fetch(`http://localhost:5000/api/bookings/${id}`, {
        method: 'DELETE'
      });
      const data = await res.json();
      if (!res.ok) {
        setGlobalMessage(data.error?.message || 'Failed to cancel booking.');
      } else {
        setConfirmCancelId(null);
        setGlobalMessage('Booking cancelled successfully.');
        fetchBookings(selectedDate);
      }
    } catch {
      setGlobalMessage('Network error while cancelling booking.');
    } finally {
      setCancelLoading(false);
    }
  };

  const handleSearchAvailability = async (e) => {
    e.preventDefault();
    setSearchError('');
    setSearchResults(null);

    if (searchEnd <= searchStart) {
      setSearchError('End time must be after start time.');
      return;
    }

    setSearchLoading(true);
    try {
      const query = new URLSearchParams({
        date: searchDate,
        start: searchStart,
        end: searchEnd,
        minCapacity: searchMinCapacity
      });
      const res = await fetch(`http://localhost:5000/api/availability?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error?.message || 'Failed to search availability.');
      } else {
        setSearchResults(data);
      }
    } catch {
      setSearchError('Network error while searching availability.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSelectSearchedRoom = (room) => {
    setFormRoomId(room.id);
    setFormDate(searchDate);
    setFormStart(searchStart);
    setFormEnd(searchEnd);
    setFormAttendees(searchMinCapacity);
    window.scrollTo({ top: 350, behavior: 'smooth' });
  };

  return (
    <div className="container">
      <header className="header">
        <h1>Meeting Room Booking System</h1>
        <span className="utc-badge">All times are in UTC (08:00 - 20:00)</span>
      </header>

      {globalMessage && <div className="alert-success">{globalMessage}</div>}

      <section className="section-box">
        <h2 className="section-title">Find Available Rooms</h2>
        <form onSubmit={handleSearchAvailability}>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="search-date">Date (UTC)</label>
              <input
                id="search-date"
                type="date"
                value={searchDate}
                onChange={(e) => setSearchDate(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="search-start">Start Time (UTC)</label>
              <select
                id="search-start"
                value={searchStart}
                onChange={(e) => setSearchStart(e.target.value)}
              >
                {START_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot} UTC
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="search-end">End Time (UTC)</label>
              <select
                id="search-end"
                value={searchEnd}
                onChange={(e) => setSearchEnd(e.target.value)}
              >
                {END_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot} UTC
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="search-min-capacity">Min Capacity</label>
              <input
                id="search-min-capacity"
                type="number"
                min="1"
                value={searchMinCapacity}
                onChange={(e) => setSearchMinCapacity(Math.max(1, parseInt(e.target.value, 10) || 1))}
                required
              />
            </div>
          </div>
          <button type="submit" className="btn btn-primary" disabled={searchLoading}>
            {searchLoading ? 'Searching...' : 'Find Free Rooms'}
          </button>
        </form>

        {searchError && <div className="alert-error">{searchError}</div>}

        {searchResults !== null && (
          <div style={{ marginTop: '16px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Available Rooms ({searchResults.length})</h3>
            {searchResults.length === 0 ? (
              <p className="empty-text">No free rooms match this window and capacity.</p>
            ) : (
              <table className="results-table">
                <thead>
                  <tr>
                    <th>Room</th>
                    <th>Capacity</th>
                    <th>Floor</th>
                    <th>Amenities</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((r) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.capacity}</td>
                      <td>{r.floor}</td>
                      <td>{r.amenities.length > 0 ? r.amenities.join(', ') : 'None'}</td>
                      <td>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                          onClick={() => handleSelectSearchedRoom(r)}
                        >
                          Book this Room
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      <section className="section-box">
        <h2 className="section-title">Create a Booking</h2>
        <form onSubmit={handleCreateBooking}>
          <div className="form-grid">
            <div className="form-group">
              <label htmlFor="booking-room">Meeting Room</label>
              <select
                id="booking-room"
                value={formRoomId}
                onChange={(e) => setFormRoomId(e.target.value)}
                required
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name} (Cap: {room.capacity}, Floor {room.floor})
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="booking-title">Meeting Title</label>
              <input
                id="booking-title"
                type="text"
                placeholder="e.g. Sprint Planning"
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="booking-email">Organizer Email</label>
              <input
                id="booking-email"
                type="email"
                placeholder="e.g. sam@example.com"
                value={formEmail}
                onChange={(e) => setFormEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="booking-attendees">Attendees Count</label>
              <input
                id="booking-attendees"
                type="number"
                min="1"
                value={formAttendees}
                onChange={(e) => setFormAttendees(Math.max(1, parseInt(e.target.value, 10) || 1))}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="booking-date">Date (UTC)</label>
              <input
                id="booking-date"
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="booking-start">Start Time (UTC)</label>
              <select
                id="booking-start"
                value={formStart}
                onChange={(e) => setFormStart(e.target.value)}
              >
                {START_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot} UTC
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="booking-end">End Time (UTC)</label>
              <select
                id="booking-end"
                value={formEnd}
                onChange={(e) => setFormEnd(e.target.value)}
              >
                {END_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot} UTC
                  </option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" className="btn btn-primary" disabled={formSubmitting}>
            {formSubmitting ? 'Booking...' : 'Book Room'}
          </button>

          {formClientError && <div className="alert-error">{formClientError}</div>}
          {formServerError && <div className="alert-error">{formServerError}</div>}
        </form>
      </section>

      <section className="section-box">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
          <h2 className="section-title" style={{ margin: 0 }}>Room Schedule (Day View)</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <label htmlFor="schedule-date" style={{ fontSize: '0.88rem', fontWeight: 600 }}>Date (UTC):</label>
            <input
              id="schedule-date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '0.88rem' }}
            />
          </div>
        </div>

        {loadingRooms || loadingBookings ? (
          <p className="loading-text">Loading room schedule...</p>
        ) : rooms.length === 0 ? (
          <p className="empty-text">No meeting rooms found.</p>
        ) : (
          <div>
            {rooms.map((room) => {
              const roomBookings = bookings.filter((b) => Number(b.roomId) === Number(room.id));
              return (
                <div key={room.id} className="room-card">
                  <div className="room-header">
                    <div>
                      <span className="room-name">{room.name}</span>
                      <span className="room-meta" style={{ marginLeft: '10px' }}>
                        Capacity: {room.capacity} | Floor {room.floor} | Amenities: {room.amenities.length > 0 ? room.amenities.join(', ') : 'None'}
                      </span>
                    </div>
                    <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                      {roomBookings.length} booking{roomBookings.length !== 1 ? 's' : ''}
                    </span>
                  </div>

                  {roomBookings.length === 0 ? (
                    <p className="empty-text" style={{ fontSize: '0.82rem' }}>No bookings for this room on {selectedDate}.</p>
                  ) : (
                    <div>
                      {roomBookings.map((b) => {
                        const startDisplay = b.start.slice(11, 16);
                        const endDisplay = b.end.slice(11, 16);
                        return (
                          <div key={b.id} className="booking-item">
                            <div className="booking-info">
                              <span className="booking-time">{startDisplay} - {endDisplay} UTC</span>
                              <span style={{ fontWeight: 600 }}>{b.title}</span>
                              <div className="booking-details">
                                Organizer: {b.organizerEmail} | Attendees: {b.attendees}
                              </div>
                            </div>

                            <div>
                              {confirmCancelId === b.id ? (
                                <div className="cancel-actions">
                                  <button
                                    type="button"
                                    className="btn btn-confirm"
                                    disabled={cancelLoading}
                                    onClick={() => handleCancelBooking(b.id)}
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    className="btn btn-secondary"
                                    style={{ fontSize: '0.8rem', padding: '4px 8px' }}
                                    onClick={() => setConfirmCancelId(null)}
                                  >
                                    Keep
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-danger"
                                  onClick={() => setConfirmCancelId(b.id)}
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
