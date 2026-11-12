import { Capacitor } from '@capacitor/core';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  getAdditionalUserInfo,
  initializeAuth,
  indexedDBLocalPersistence,
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  onAuthStateChanged,
  signOut as firebaseSignOut
} from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';

const firebaseConfig = {
  apiKey: 'AIzaSyBiSgPe2fgHh-75uvneZdp8KoCACdSbIcQ',
  authDomain: 'locked-in-ed224.firebaseapp.com',
  projectId: 'locked-in-ed224',
  storageBucket: 'locked-in-ed224.firebasestorage.app',
  messagingSenderId: '498563149400',
  appId: '1:498563149400:web:24abbc7c4644554896e42d',
  measurementId: 'G-K3DTCF286N'
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
let authPromise;

async function getFirebaseAuth() {
  if (!authPromise) {
    authPromise = (async () => {
      if (Capacitor.isNativePlatform()) {
        try {
          return initializeAuth(app, { persistence: indexedDBLocalPersistence });
        } catch (error) {
          if (error.code === 'auth/already-initialized') return getAuth(app);
          throw error;
        }
      }
      return getAuth(app);
    })();
  }
  return authPromise;
}

const db = getFirestore(app);
const cloudReadyUsers = new Set();
const saveTimers = new Map();
const pendingSaveData = new Map();
const savePromises = new Map();
const authStateListeners = new Set();
let authActionInProgress = false;

// Firestore rejects an array that directly contains another array.
// Encode only nested array elements as a tagged map, then restore them on read.
const NESTED_ARRAY_TAG = '__lockedInFirestoreNestedArrayV1__';
function encodeFirestoreValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => Array.isArray(item)
      ? { [NESTED_ARRAY_TAG]: encodeFirestoreValue(item) }
      : encodeFirestoreValue(item));
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = encodeFirestoreValue(child);
    return result;
  }
  return value;
}
function decodeFirestoreValue(value) {
  if (Array.isArray(value)) return value.map(decodeFirestoreValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === NESTED_ARRAY_TAG && Array.isArray(value[NESTED_ARRAY_TAG])) {
      return decodeFirestoreValue(value[NESTED_ARRAY_TAG]);
    }
    const result = {};
    for (const [key, child] of Object.entries(value)) result[key] = decodeFirestoreValue(child);
    return result;
  }
  return value;
}

function userDocument(uid) {
  return doc(db, 'users', uid, 'appData', 'main');
}

function isGoogleCancellation(error) {
  const values = [error?.code, error?.message, error?.customData?.message]
    .filter(Boolean).join(' ').toLowerCase();
  return values.includes('12501') || values.includes('sign_in_canceled') ||
    values.includes('sign-in-canceled') || values.includes('cancelled') ||
    values.includes('canceled') || values.includes('popup-closed-by-user');
}

async function clearAuthenticatedSession(auth) {
  const uid = auth.currentUser?.uid;
  if (uid) cloudReadyUsers.delete(uid);
  if (Capacitor.isNativePlatform()) {
    try { await FirebaseAuthentication.signOut(); } catch (_) { /* already cancelled/signed out */ }
  }
  if (auth.currentUser) await firebaseSignOut(auth);
}

async function signInWithGoogle(action, _initialData = {}) {
  if (action !== 'signup' && action !== 'signin') {
    throw new Error('Choose Sign Up or Sign In to continue.');
  }
  const auth = await getFirebaseAuth();
  let userCredential;
  authActionInProgress = true;
  try {
    if (Capacitor.isNativePlatform()) {
      const result = await FirebaseAuthentication.signInWithGoogle({ skipNativeAuth: true });
      const idToken = result?.credential?.idToken;
      if (!idToken) throw new Error('Google sign-in did not return an ID token.');
      userCredential = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    } else {
      userCredential = await signInWithPopup(auth, new GoogleAuthProvider());
    }

    const user = userCredential.user;
    const reference = userDocument(user.uid);
    const snapshot = await getDoc(reference);
    const accountExists = snapshot.exists();

    if (action === 'signin' && !accountExists) {
      await clearAuthenticatedSession(auth);
      const error = new Error('No account found. Please choose Sign Up to create one.');
      error.code = 'lockedin/account-not-found';
      throw error;
    }
    if (action === 'signup' && accountExists) {
      await clearAuthenticatedSession(auth);
      const error = new Error('This account already exists. Please choose Sign In to continue.');
      error.code = 'lockedin/account-already-exists';
      throw error;
    }

    if (action === 'signup') {
      // New accounts always start empty. Guest data is never copied into a cloud account.
      await setDoc(reference, { data: {}, createdAt: Date.now(), updatedAt: Date.now() });
    }
    // Cloud writes stay disabled until the app has loaded this user's cloud data.
    return { user, isNewUser: !!getAdditionalUserInfo(userCredential)?.isNewUser, isNewAccount: action === 'signup' };
  } catch (error) {
    if (isGoogleCancellation(error)) {
      const cancelled = new Error('Google sign-in was cancelled.');
      cancelled.code = 'auth/cancelled';
      throw cancelled;
    }
    throw error;
  } finally {
    authActionInProgress = false;
    const currentUser = auth.currentUser;
    queueMicrotask(() => {
      for (const listener of authStateListeners) listener(currentUser);
    });
  }
}

async function prepareCloudSync() {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('No signed-in user.');
  const snapshot = await getDoc(userDocument(user.uid));
  if (!snapshot.exists()) throw new Error('No cloud account data exists yet.');
  cloudReadyUsers.add(user.uid);
  return true;
}

async function syncUserData(_ignoredLocalData = {}) {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('No signed-in user.');
  const reference = userDocument(user.uid);
  const snapshot = await getDoc(reference);
  if (snapshot.exists()) {
    const cloudData = snapshot.data()?.data;
    if (!cloudData || typeof cloudData !== 'object' || Array.isArray(cloudData)) {
      throw new Error('Cloud backup data is invalid.');
    }
    // Do not enable writes until the caller has installed this data locally.
    return { exists: true, data: decodeFirestoreValue(cloudData) };
  }
  const emptyData = {};
  await setDoc(reference, { data: emptyData, createdAt: Date.now(), updatedAt: Date.now() });
  return { exists: true, data: emptyData };
}

function writeUserData(uid, data) {
  const previous = savePromises.get(uid) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => setDoc(userDocument(uid), {
    data: encodeFirestoreValue(data),
    updatedAt: Date.now()
  }, { merge: true }));
  savePromises.set(uid, current);
  return current;
}

async function flushUserData() {
  const auth = await getFirebaseAuth();
  const uid = auth.currentUser?.uid;
  if (!uid || !cloudReadyUsers.has(uid)) return;
  const timer = saveTimers.get(uid);
  if (timer) clearTimeout(timer);
  saveTimers.delete(uid);
  if (pendingSaveData.has(uid)) {
    const latest = pendingSaveData.get(uid);
    // Keep the pending copy until Firestore confirms the write. If it fails,
    // local app storage remains the source of truth and this queue is retained.
    await writeUserData(uid, latest);
    if (pendingSaveData.get(uid) === latest) pendingSaveData.delete(uid);
  }
  const pending = savePromises.get(uid);
  if (pending) await pending;
}

function saveUserData(data) {
  return (async () => {
    const auth = await getFirebaseAuth();
    const user = auth.currentUser;
    if (!user || !cloudReadyUsers.has(user.uid)) return;
    const uid = user.uid;
    pendingSaveData.set(uid, data);
    const oldTimer = saveTimers.get(uid);
    if (oldTimer) clearTimeout(oldTimer);
    const timer = setTimeout(async () => {
      saveTimers.delete(uid);
      if (!pendingSaveData.has(uid)) return;
      const latest = pendingSaveData.get(uid);
      try {
        await writeUserData(uid, latest);
        if (pendingSaveData.get(uid) === latest) pendingSaveData.delete(uid);
      } catch (error) {
        console.error('Cloud save failed; pending data retained for retry:', error);
      }
    }, 700);
    saveTimers.set(uid, timer);
  })().catch(error => console.error('Cloud save scheduling failed:', error));
}

async function signOut() {
  const auth = await getFirebaseAuth();
  let cloudSaveFailed = false;
  try {
    await flushUserData();
  } catch (error) {
    // Do not trap the user in their account because a cloud write failed.
    // The app's local master/guest backup remains untouched.
    cloudSaveFailed = true;
    console.error('Cloud save failed during sign-out; continuing with sign-out:', error);
  }

  const uid = auth.currentUser?.uid;
  if (uid) cloudReadyUsers.delete(uid);

  if (Capacitor.isNativePlatform()) {
    try { await FirebaseAuthentication.signOut(); }
    catch (error) { console.warn('Native Google sign-out did not complete cleanly:', error); }
  }
  if (auth.currentUser) await firebaseSignOut(auth);
  return { cloudSaveFailed };
}

async function watchAuthState(callback) {
  const auth = await getFirebaseAuth();
  authStateListeners.add(callback);
  const unsubscribe = onAuthStateChanged(auth, user => {
    // Google account existence checks must finish before the app's cloud listener runs.
    // Otherwise a missing account could be auto-created by syncUserData during sign-in.
    if (authActionInProgress) return;
    callback(user);
  });
  return () => {
    authStateListeners.delete(callback);
    unsubscribe();
  };
}

window.addEventListener('pagehide', () => { flushUserData().catch(error => console.error('Cloud flush failed:', error)); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushUserData().catch(error => console.error('Cloud flush failed:', error));
});

window.LockedInFirebase = {
  app, db, getAuth: getFirebaseAuth, signInWithGoogle, signOut,
  watchAuthState, syncUserData, prepareCloudSync, saveUserData, flushUserData
};
