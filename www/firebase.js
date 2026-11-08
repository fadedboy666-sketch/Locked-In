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

async function signInWithGoogle(action, initialData = {}) {
  const auth = await getFirebaseAuth();
  let userCredential;
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
      const error = new Error('No Locked In account exists for this Google account. Choose Sign Up first.');
      error.code = 'lockedin/account-not-found';
      throw error;
    }
    if (action === 'signup' && accountExists) {
      await clearAuthenticatedSession(auth);
      const error = new Error('A Locked In account already exists for this Google account. Choose Sign In.');
      error.code = 'lockedin/account-already-exists';
      throw error;
    }

    if (action === 'signup') {
      await setDoc(reference, {
        data: initialData && typeof initialData === 'object' ? initialData : {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
    }
    cloudReadyUsers.add(user.uid);
    return { user, isNewUser: !!getAdditionalUserInfo(userCredential)?.isNewUser, isNewAccount: action === 'signup' };
  } catch (error) {
    if (isGoogleCancellation(error)) {
      const cancelled = new Error('Google sign-in was cancelled.');
      cancelled.code = 'auth/cancelled';
      throw cancelled;
    }
    throw error;
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

async function syncUserData(localData) {
  const auth = await getFirebaseAuth();
  const user = auth.currentUser;
  if (!user) throw new Error('No signed-in user.');
  const reference = userDocument(user.uid);
  const snapshot = await getDoc(reference);
  if (snapshot.exists()) {
    const cloudData = snapshot.data()?.data;
    if (!cloudData || typeof cloudData !== 'object') throw new Error('Cloud backup data is invalid.');
    cloudReadyUsers.add(user.uid);
    return { exists: true, data: cloudData };
  }
  await setDoc(reference, { data: localData || {}, createdAt: Date.now(), updatedAt: Date.now() });
  cloudReadyUsers.add(user.uid);
  return { exists: false, data: null };
}

function writeUserData(uid, data) {
  const previous = savePromises.get(uid) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => setDoc(userDocument(uid), {
    data,
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
    pendingSaveData.delete(uid);
    await writeUserData(uid, latest);
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
      pendingSaveData.delete(uid);
      try { await writeUserData(uid, latest); }
      catch (error) { console.error('Cloud save failed:', error); }
    }, 700);
    saveTimers.set(uid, timer);
  })().catch(error => console.error('Cloud save scheduling failed:', error));
}

async function signOut() {
  const auth = await getFirebaseAuth();
  await flushUserData();
  const uid = auth.currentUser?.uid;
  if (uid) cloudReadyUsers.delete(uid);
  if (Capacitor.isNativePlatform()) {
    try { await FirebaseAuthentication.signOut(); }
    finally { if (auth.currentUser) await firebaseSignOut(auth); }
  } else if (auth.currentUser) {
    await firebaseSignOut(auth);
  }
}

async function watchAuthState(callback) {
  const auth = await getFirebaseAuth();
  return onAuthStateChanged(auth, callback);
}

window.addEventListener('pagehide', () => { flushUserData().catch(error => console.error('Cloud flush failed:', error)); });
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushUserData().catch(error => console.error('Cloud flush failed:', error));
});

window.LockedInFirebase = {
  app, db, getAuth: getFirebaseAuth, signInWithGoogle, signOut,
  watchAuthState, syncUserData, prepareCloudSync, saveUserData, flushUserData
};
