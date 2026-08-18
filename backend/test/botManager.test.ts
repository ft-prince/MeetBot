import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isTeamsUrl, extractMeetingId } from '../src/bot/botManager'

test('isTeamsUrl matches both Teams hosts', () => {
  assert.equal(isTeamsUrl('https://teams.microsoft.com/l/meetup-join/19%3ameeting_X%40thread.v2/0'), true)
  assert.equal(isTeamsUrl('https://teams.live.com/meet/9352846271234'), true)
})

test('isTeamsUrl rejects Meet and Zoom links', () => {
  assert.equal(isTeamsUrl('https://meet.google.com/abc-defg-hij'), false)
  assert.equal(isTeamsUrl('https://us05web.zoom.us/wc/join/89012345678'), false)
})

test('extractMeetingId derives a stable id from a Teams meetup-join link', () => {
  // Arrange
  const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC123def%40thread.v2/0?context=%7b%7d'

  // Act
  const id = extractMeetingId(url)

  // Assert — prefixed + derived from the conversation id, not a timestamp
  assert.ok(id.startsWith('teams-'), 'uses the teams- prefix')
  assert.ok(id.includes('ABC123def'), 'derives from the embedded meeting id')
  assert.ok(!/teams-\d{13}$/.test(id), 'is not the timestamp fallback')
})

test('extractMeetingId handles teams.live.com personal links', () => {
  // Arrange
  const url = 'https://teams.live.com/meet/9352846271234?p=AbCdEf'

  // Act
  const id = extractMeetingId(url)

  // Assert
  assert.equal(id, 'teams-9352846271234')
})

test('extractMeetingId still resolves Meet and Zoom ids (no regression)', () => {
  assert.equal(extractMeetingId('https://meet.google.com/abc-defg-hij'), 'abc-defg-hij')
  assert.equal(extractMeetingId('https://us05web.zoom.us/wc/join/89012345678'), 'zoom-89012345678')
})

test('extractMeetingId falls back to a URL-derived id for an unparseable Teams link', () => {
  // Arrange — a Teams host but no recognizable meeting id in the path
  const url = 'https://teams.microsoft.com/_#/conversations'

  // Act
  const id = extractMeetingId(url)

  // Assert — stable, not timestamped: a fresh id per launch would defeat the
  // duplicate-bot guard and stop()/exit() lookups by meeting id.
  assert.ok(/^teams-[0-9a-f]{16}$/.test(id), 'uses the teams- URL-hash fallback')
  assert.equal(id, extractMeetingId(url), 'same URL always yields the same id')
})
