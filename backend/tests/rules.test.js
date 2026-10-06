import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTimeWindow,
  validateBookingFields,
  checkRoomCapacity,
  checkOverlap,
  checkOrganizerDailyLimit,
  canCancelBooking
} from '../rules.js';

test('Overlap reference cases - Atlas from 10:00 to 11:00', () => {
  const existingBookings = [
    {
      id: 1,
      roomId: 1,
      start: '2030-05-14T10:00:00.000Z',
      end: '2030-05-14T11:00:00.000Z',
      status: 'confirmed'
    }
  ];

  const case1 = checkOverlap(1, '2030-05-14T09:00:00.000Z', '2030-05-14T10:00:00.000Z', existingBookings);
  assert.equal(case1, null);

  const case2 = checkOverlap(1, '2030-05-14T11:00:00.000Z', '2030-05-14T12:00:00.000Z', existingBookings);
  assert.equal(case2, null);

  const case3 = checkOverlap(1, '2030-05-14T09:30:00.000Z', '2030-05-14T10:30:00.000Z', existingBookings);
  assert.notEqual(case3, null);
  assert.equal(case3.id, 1);

  const case4 = checkOverlap(1, '2030-05-14T10:30:00.000Z', '2030-05-14T11:30:00.000Z', existingBookings);
  assert.notEqual(case4, null);
  assert.equal(case4.id, 1);

  const case5 = checkOverlap(1, '2030-05-14T10:15:00.000Z', '2030-05-14T10:45:00.000Z', existingBookings);
  assert.notEqual(case5, null);
  assert.equal(case5.id, 1);

  const case6 = checkOverlap(1, '2030-05-14T09:00:00.000Z', '2030-05-14T12:00:00.000Z', existingBookings);
  assert.notEqual(case6, null);
  assert.equal(case6.id, 1);

  const case7 = checkOverlap(1, '2030-05-14T10:00:00.000Z', '2030-05-14T11:00:00.000Z', existingBookings);
  assert.notEqual(case7, null);
  assert.equal(case7.id, 1);

  const case8 = checkOverlap(2, '2030-05-14T10:00:00.000Z', '2030-05-14T11:00:00.000Z', existingBookings);
  assert.equal(case8, null);

  const cancelledBookings = [
    {
      id: 2,
      roomId: 1,
      start: '2030-05-14T10:00:00.000Z',
      end: '2030-05-14T11:00:00.000Z',
      status: 'cancelled'
    }
  ];
  const caseCancelled = checkOverlap(1, '2030-05-14T10:00:00.000Z', '2030-05-14T11:00:00.000Z', cancelledBookings);
  assert.equal(caseCancelled, null);
});

test('Rule R1: end must be after start', () => {
  const result = validateTimeWindow('2030-05-14T10:00:00.000Z', '2030-05-14T09:00:00.000Z');
  assert.equal(result.valid, false);
  assert.equal(result.code, 'INVALID_TIME_ORDER');

  const equalResult = validateTimeWindow('2030-05-14T10:00:00.000Z', '2030-05-14T10:00:00.000Z');
  assert.equal(equalResult.valid, false);
  assert.equal(equalResult.code, 'INVALID_TIME_ORDER');
});

test('Rule R2: start and end must fall on 15-minute boundaries with zero seconds', () => {
  const invalidMinutes = validateTimeWindow('2030-05-14T10:07:00.000Z', '2030-05-14T11:00:00.000Z');
  assert.equal(invalidMinutes.valid, false);
  assert.equal(invalidMinutes.code, 'INVALID_BOUNDARY');

  const invalidSeconds = validateTimeWindow('2030-05-14T10:00:15.000Z', '2030-05-14T11:00:00.000Z');
  assert.equal(invalidSeconds.valid, false);
  assert.equal(invalidSeconds.code, 'INVALID_BOUNDARY');

  const valid = validateTimeWindow('2030-05-14T10:15:00.000Z', '2030-05-14T10:30:00.000Z');
  assert.equal(valid.valid, true);
});

test('Rule R3: duration must be between 15 minutes and 4 hours', () => {
  const tooShort = validateTimeWindow('2030-05-14T10:00:00.000Z', '2030-05-14T10:05:00.000Z');
  assert.equal(tooShort.valid, false);

  const tooLong = validateTimeWindow('2030-05-14T10:00:00.000Z', '2030-05-14T14:15:00.000Z');
  assert.equal(tooLong.valid, false);
  assert.equal(tooLong.code, 'INVALID_DURATION');

  const exactly15Min = validateTimeWindow('2030-05-14T10:00:00.000Z', '2030-05-14T10:15:00.000Z');
  assert.equal(exactly15Min.valid, true);

  const exactly4Hours = validateTimeWindow('2030-05-14T10:00:00.000Z', '2030-05-14T14:00:00.000Z');
  assert.equal(exactly4Hours.valid, true);
});

test('Rule R4: business hours 08:00 to 20:00 UTC and same UTC day', () => {
  const early = validateTimeWindow('2030-05-14T07:45:00.000Z', '2030-05-14T09:00:00.000Z');
  assert.equal(early.valid, false);
  assert.equal(early.code, 'OUTSIDE_BUSINESS_HOURS');

  const late = validateTimeWindow('2030-05-14T19:00:00.000Z', '2030-05-14T20:15:00.000Z');
  assert.equal(late.valid, false);
  assert.equal(late.code, 'OUTSIDE_BUSINESS_HOURS');

  const crossDay = validateTimeWindow('2030-05-14T23:45:00.000Z', '2030-05-15T00:15:00.000Z');
  assert.equal(crossDay.valid, false);
  assert.equal(crossDay.code, 'OUTSIDE_BUSINESS_HOURS');

  const boundaryAllowed = validateTimeWindow('2030-05-14T08:00:00.000Z', '2030-05-14T20:00:00.000Z');
  assert.equal(boundaryAllowed.valid, false);

  const maxValidAtBoundary = validateTimeWindow('2030-05-14T16:00:00.000Z', '2030-05-14T20:00:00.000Z');
  assert.equal(maxValidAtBoundary.valid, true);
});

test('Rule R5: booking cannot start in past', () => {
  const fixedNow = new Date('2030-05-14T12:00:00.000Z');
  const past = validateTimeWindow('2030-05-14T10:00:00.000Z', '2030-05-14T11:00:00.000Z', fixedNow);
  assert.equal(past.valid, false);
  assert.equal(past.code, 'PAST_BOOKING');

  const future = validateTimeWindow('2030-05-14T13:00:00.000Z', '2030-05-14T14:00:00.000Z', fixedNow);
  assert.equal(future.valid, true);
});

test('Rule R6: attendees cannot exceed room capacity', () => {
  const ok = checkRoomCapacity(4, 4);
  assert.equal(ok.valid, true);

  const exceeded = checkRoomCapacity(5, 4);
  assert.equal(exceeded.valid, false);
  assert.equal(exceeded.code, 'CAPACITY_EXCEEDED');
});

test('Rule R8: cannot cancel booking that has started', () => {
  const fixedNow = new Date('2030-05-14T10:30:00.000Z');
  const started = {
    start: '2030-05-14T10:00:00.000Z',
    status: 'confirmed'
  };
  const result = canCancelBooking(started, fixedNow);
  assert.equal(result.allowed, false);
  assert.equal(result.code, 'CANNOT_CANCEL_STARTED');

  const upcoming = {
    start: '2030-05-14T11:00:00.000Z',
    status: 'confirmed'
  };
  const resultOk = canCancelBooking(upcoming, fixedNow);
  assert.equal(resultOk.allowed, true);
  assert.equal(resultOk.isNoop, false);

  const cancelled = {
    start: '2030-05-14T09:00:00.000Z',
    status: 'cancelled'
  };
  const resultNoop = canCancelBooking(cancelled, fixedNow);
  assert.equal(resultNoop.allowed, true);
  assert.equal(resultNoop.isNoop, true);
});

test('Rule R9: organizer cannot hold more than 3 confirmed bookings starting on same day', () => {
  const existing = [
    { organizerEmail: 'sam@example.com', start: '2030-05-14T08:00:00.000Z', status: 'confirmed' },
    { organizerEmail: 'sam@example.com', start: '2030-05-14T10:00:00.000Z', status: 'confirmed' },
    { organizerEmail: 'sam@example.com', start: '2030-05-14T13:00:00.000Z', status: 'confirmed' }
  ];

  const fourth = checkOrganizerDailyLimit('sam@example.com', '2030-05-14', existing);
  assert.equal(fourth.valid, false);
  assert.equal(fourth.code, 'ORGANIZER_LIMIT_EXCEEDED');

  const otherOrganizer = checkOrganizerDailyLimit('alex@example.com', '2030-05-14', existing);
  assert.equal(otherOrganizer.valid, true);

  const otherDay = checkOrganizerDailyLimit('sam@example.com', '2030-05-15', existing);
  assert.equal(otherDay.valid, true);
});

test('Field validations', () => {
  const valid = validateBookingFields({
    roomId: 1,
    title: 'Standup',
    organizerEmail: 'team@example.com',
    attendees: 3
  });
  assert.equal(valid.valid, true);

  const emptyTitle = validateBookingFields({
    roomId: 1,
    title: '   ',
    organizerEmail: 'team@example.com',
    attendees: 3
  });
  assert.equal(emptyTitle.valid, false);

  const invalidEmail = validateBookingFields({
    roomId: 1,
    title: 'Standup',
    organizerEmail: 'not-an-email',
    attendees: 3
  });
  assert.equal(invalidEmail.valid, false);

  const zeroAttendees = validateBookingFields({
    roomId: 1,
    title: 'Standup',
    organizerEmail: 'team@example.com',
    attendees: 0
  });
  assert.equal(zeroAttendees.valid, false);
});
