import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateScheduleInput } from '../src/services/scheduledMeetingService'

const futureDate = () => new Date(Date.now() + 60 * 60_000) // 1 hour out

test('accepts a teams.microsoft.com meetup-join link', () => {
  // Arrange
  const input = {
    title: 'Teams Sync',
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0',
    scheduledFor: futureDate(),
  }

  // Act
  const error = validateScheduleInput(input)

  // Assert
  assert.equal(error, null)
})

test('accepts a teams.live.com personal meeting link', () => {
  // Arrange
  const input = {
    title: 'Family Call',
    meetingUrl: 'https://teams.live.com/meet/9352846271234',
    scheduledFor: futureDate(),
  }

  // Act
  const error = validateScheduleInput(input)

  // Assert
  assert.equal(error, null)
})

test('still accepts Google Meet and Zoom links (no regression)', () => {
  // Arrange
  const meet = {
    title: 'Meet',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    scheduledFor: futureDate(),
  }
  const zoom = {
    title: 'Zoom',
    meetingUrl: 'https://us05web.zoom.us/wc/join/89012345678',
    scheduledFor: futureDate(),
  }

  // Act + Assert
  assert.equal(validateScheduleInput(meet), null)
  assert.equal(validateScheduleInput(zoom), null)
})

test('rejects a non-meeting URL with a Teams-aware message', () => {
  // Arrange
  const input = {
    title: 'Bad',
    meetingUrl: 'https://example.com/whatever',
    scheduledFor: futureDate(),
  }

  // Act
  const error = validateScheduleInput(input)

  // Assert
  assert.ok(error && /Teams/.test(error), 'error mentions Teams as an accepted platform')
})

test('rejects a Teams link scheduled in the past', () => {
  // Arrange
  const input = {
    title: 'Late',
    meetingUrl: 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_X%40thread.v2/0',
    scheduledFor: new Date(Date.now() - 60 * 60_000), // 1 hour ago
  }

  // Act
  const error = validateScheduleInput(input)

  // Assert
  assert.ok(error && /future/.test(error), 'rejects past times even for valid Teams URLs')
})
