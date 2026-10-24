import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSignedInProfile, isGoogleSignedInUrl } from '../src/bot/sessionKeeper';

test('picks the signed-in profile even when Default exists and is signed out (real local layout)', () => {
  const localState = { profile: { last_used: 'Profile 2', info_cache: {
    Default: { user_name: '' },
    'Profile 1': { user_name: '' },
    'Profile 2': { user_name: 'bot@nexren.ai' },
  } } };
  assert.deepEqual(pickSignedInProfile(localState), { directory: 'Profile 2', email: 'bot@nexren.ai' });
});

test('stays on the signed-in profile if "last used" flipped to a signed-out one', () => {
  const localState = { profile: { last_used: 'Default', info_cache: {
    Default: { user_name: '' },
    'Profile 2': { user_name: 'bot@nexren.ai' },
  } } };
  assert.equal(pickSignedInProfile(localState).directory, 'Profile 2');
});

test('prefers last used when several profiles are signed in', () => {
  const localState = { profile: { last_used: 'Profile 3', info_cache: {
    'Profile 2': { user_name: 'a@x.com' },
    'Profile 3': { user_name: 'b@x.com' },
  } } };
  assert.equal(pickSignedInProfile(localState).directory, 'Profile 3');
});

test('no Chrome account recorded → Chrome\'s own last-used choice, else Default', () => {
  assert.equal(pickSignedInProfile({ profile: { last_used: 'Profile 1', info_cache: { 'Profile 1': {} } } }).directory, 'Profile 1');
  assert.equal(pickSignedInProfile({}).directory, 'Default');
  assert.equal(pickSignedInProfile(null).directory, 'Default');
});

test('Google sign-in URL detection', () => {
  assert.equal(isGoogleSignedInUrl('https://myaccount.google.com/?pli=1'), true);
  assert.equal(isGoogleSignedInUrl('https://accounts.google.com/v3/signin/identifier?continue=https://myaccount.google.com'), false);
  assert.equal(isGoogleSignedInUrl('https://accounts.google.com/ServiceLogin?service=accountsettings'), false);
  // What a signed-out profile actually lands on today (observed live).
  assert.equal(isGoogleSignedInUrl('https://www.google.com/account/about/?hl=en-US'), false);
});
