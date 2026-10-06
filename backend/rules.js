export function validateTimeWindow(startInput, endInput, now = new Date()) {
  const start = new Date(startInput);
  const end = new Date(endInput);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return {
      valid: false,
      code: 'INVALID_INPUT',
      message: 'Invalid start or end date format.'
    };
  }

  if (end.getTime() <= start.getTime()) {
    return {
      valid: false,
      code: 'INVALID_TIME_ORDER',
      message: 'End time must be after start time.'
    };
  }

  const validStartMinutes = start.getUTCMinutes() % 15 === 0 && start.getUTCSeconds() === 0 && start.getUTCMilliseconds() === 0;
  const validEndMinutes = end.getUTCMinutes() % 15 === 0 && end.getUTCSeconds() === 0 && end.getUTCMilliseconds() === 0;

  if (!validStartMinutes || !validEndMinutes) {
    return {
      valid: false,
      code: 'INVALID_BOUNDARY',
      message: 'Start and end must fall on 15-minute boundaries with zero seconds.'
    };
  }

  const durationMs = end.getTime() - start.getTime();
  const minDurationMs = 15 * 60 * 1000;
  const maxDurationMs = 4 * 60 * 60 * 1000;

  if (durationMs < minDurationMs || durationMs > maxDurationMs) {
    return {
      valid: false,
      code: 'INVALID_DURATION',
      message: 'A booking must last at least 15 minutes and at most 4 hours.'
    };
  }

  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate();

  if (!sameDay) {
    return {
      valid: false,
      code: 'OUTSIDE_BUSINESS_HOURS',
      message: 'A booking must start and end on the same UTC day.'
    };
  }

  const startMinutes = start.getUTCHours() * 60 + start.getUTCMinutes();
  const endMinutes = end.getUTCHours() * 60 + end.getUTCMinutes();

  if (startMinutes < 8 * 60 || endMinutes > 20 * 60) {
    return {
      valid: false,
      code: 'OUTSIDE_BUSINESS_HOURS',
      message: 'A booking must fall entirely within business hours, 08:00 to 20:00 UTC.'
    };
  }

  if (now && start.getTime() < now.getTime()) {
    return {
      valid: false,
      code: 'PAST_BOOKING',
      message: 'A booking cannot start in the past.'
    };
  }

  return { valid: true, start, end };
}

export function validateBookingFields({ title, organizerEmail, attendees, roomId }) {
  if (roomId === undefined || roomId === null || roomId === '') {
    return {
      valid: false,
      code: 'INVALID_INPUT',
      message: 'roomId is required.'
    };
  }

  if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 100) {
    return {
      valid: false,
      code: 'INVALID_INPUT',
      message: 'Title must be between 1 and 100 characters after trimming.'
    };
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (typeof organizerEmail !== 'string' || !emailRegex.test(organizerEmail.trim())) {
    return {
      valid: false,
      code: 'INVALID_INPUT',
      message: 'organizerEmail must be a valid email address.'
    };
  }

  if (typeof attendees !== 'number' || !Number.isInteger(attendees) || attendees < 1) {
    return {
      valid: false,
      code: 'INVALID_INPUT',
      message: 'Attendees must be an integer of at least 1.'
    };
  }

  return { valid: true };
}

export function checkRoomCapacity(attendees, roomCapacity) {
  if (attendees > roomCapacity) {
    return {
      valid: false,
      code: 'CAPACITY_EXCEEDED',
      message: 'attendees cannot exceed the room capacity.'
    };
  }
  return { valid: true };
}

export function checkOverlap(targetRoomId, targetStart, targetEnd, existingBookings) {
  const tStart = new Date(targetStart).getTime();
  const tEnd = new Date(targetEnd).getTime();

  for (const booking of existingBookings) {
    if (booking.status === 'cancelled') {
      continue;
    }

    const bookingRoomId = booking.roomId ?? booking.room_id;
    if (String(bookingRoomId) !== String(targetRoomId)) {
      continue;
    }

    const bStart = new Date(booking.start ?? booking.start_time).getTime();
    const bEnd = new Date(booking.end ?? booking.end_time).getTime();

    if (tStart < bEnd && bStart < tEnd) {
      return booking;
    }
  }

  return null;
}

export function checkOrganizerDailyLimit(organizerEmail, dateStr, existingBookings) {
  const emailNorm = organizerEmail.trim().toLowerCase();
  let count = 0;

  for (const booking of existingBookings) {
    if (booking.status === 'cancelled') {
      continue;
    }

    const bEmail = (booking.organizerEmail ?? booking.organizer_email ?? '').trim().toLowerCase();
    if (bEmail !== emailNorm) {
      continue;
    }

    const bDate = new Date(booking.start ?? booking.start_time).toISOString().slice(0, 10);
    if (bDate === dateStr) {
      count++;
    }
  }

  if (count >= 3) {
    return {
      valid: false,
      code: 'ORGANIZER_LIMIT_EXCEEDED',
      message: 'An organizer cannot hold more than 3 confirmed bookings that start on the same day.'
    };
  }

  return { valid: true, count };
}

export function canCancelBooking(booking, now = new Date()) {
  if (booking.status === 'cancelled') {
    return { allowed: true, isNoop: true };
  }

  const bStart = new Date(booking.start ?? booking.start_time).getTime();
  if (bStart <= now.getTime()) {
    return {
      allowed: false,
      code: 'CANNOT_CANCEL_STARTED',
      message: 'A booking that has already started cannot be cancelled.'
    };
  }

  return { allowed: true, isNoop: false };
}
