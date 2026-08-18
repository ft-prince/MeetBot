import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterTeamsParticipantNames, toTeamsWebClientUrl } from '../src/bot/teamsBot'
import { extractMeetingId } from '../src/bot/botManager'

test('teams.live.com personal links are returned unchanged', () => {
  // Arrange
  const url = 'https://teams.live.com/meet/9352846271234?p=AbCdEf123'

  // Act
  const result = toTeamsWebClientUrl(url)

  // Assert
  assert.equal(result, url)
})

test('teams.microsoft.com meetup-join links get web-client launch hints', () => {
  // Arrange
  const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC123%40thread.v2/0?context=%7b%7d'

  // Act
  const result = toTeamsWebClientUrl(url)

  // Assert — original path preserved, browser-launch hints appended
  assert.ok(result.includes('/l/meetup-join/'), 'preserves the meetup-join path')
  assert.ok(result.includes('msLaunch=0'), 'forces web launch')
  assert.ok(result.includes('directDl=0'), 'skips desktop download')
  assert.ok(result.includes('enableMobilePage=true'), 'enables the light web page')
})

test('existing query params on a Teams link are preserved', () => {
  // Arrange
  const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_XYZ%40thread.v2/0?context=%7bfoo%7d'

  // Act
  const result = toTeamsWebClientUrl(url)

  // Assert
  assert.ok(result.includes('context='), 'keeps the original context param')
  assert.ok(result.includes('msLaunch=0'), 'adds the launch hint alongside it')
})

test('a Teams link that already has msLaunch is not duplicated', () => {
  // Arrange
  const url = 'https://teams.microsoft.com/l/meetup-join/19%3ameeting_Q%40thread.v2/0?msLaunch=1'

  // Act
  const result = toTeamsWebClientUrl(url)

  // Assert — the existing value is left intact, not overwritten or repeated
  const occurrences = result.split('msLaunch=').length - 1
  assert.equal(occurrences, 1, 'msLaunch appears exactly once')
  assert.ok(result.includes('msLaunch=1'), 'keeps the caller-provided value')
})

test('malformed input is returned unchanged instead of throwing', () => {
  // Arrange
  const garbage = 'not a url'

  // Act
  const result = toTeamsWebClientUrl(garbage)

  // Assert
  assert.equal(result, garbage)
})

test('roster filter keeps real people and drops the bot plus UI strings', () => {
  // Arrange
  const raw = ['Prince Saiyad', 'NoteAI Recorder', 'People', 'In this meeting', 'Ana Ruiz']

  // Act
  const result = filterTeamsParticipantNames(raw)

  // Assert
  assert.deepEqual(result, ['Prince Saiyad', 'Ana Ruiz'])
})

test('roster filter drops screen-share pseudo-entries', () => {
  // Arrange — a share adds rows that are not participants; counting them would
  // hide "everyone left" and could bind a transcript segment to a non-person.
  const raw = ["Prince Saiyad's screen", 'Prince Saiyad is presenting', 'Content', 'Screen share', 'Ana Ruiz']

  // Act
  const result = filterTeamsParticipantNames(raw)

  // Assert
  assert.deepEqual(result, ['Ana Ruiz'])
})

test('an unrecognized Teams link yields a stable meeting id across launches', () => {
  // Arrange
  const url = 'https://teams.microsoft.com/l/meetup-join/some-new-link-shape'

  // Act
  const first = extractMeetingId(url)
  const second = extractMeetingId(url)

  // Assert — a timestamped id would mint a new one per launch, so the
  // duplicate-bot guard and stop()/exit() by meeting id would both miss.
  assert.equal(first, second)
  assert.match(first, /^teams-[0-9a-f]{16}$/)
})

test('non-Teams URLs are passed through untouched', () => {
  // Arrange
  const url = 'https://zoom.us/wc/join/123456789'

  // Act
  const result = toTeamsWebClientUrl(url)

  // Assert
  assert.equal(result, url)
})
